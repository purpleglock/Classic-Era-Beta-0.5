-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ПУСТАЯ КВАДРАТНАЯ АРЕНА У ДУЭЛЕЙ КЛУБА — почему и как чинится
-- ────────────────────────────────────────────────────────────
-- СИМПТОМ: дуэль клуба открывается «просто квадратной картой» — без рваной
-- кромки арены, без астероидов, гряд и створов. Ландшафта нет вообще.
--
-- ПРИЧИНА. Поле боя собирается ТОЛЬКО в таком порядке (_bt_ensure_field из
-- _bt_arena_shape.sql): форма → сектора спавна → ландшафт. Ландшафт обходит
-- сектора и обрезается по кромке формы, значит и то и другое должно уже
-- лежать в строке боя.
--   `fc_watch_state` (зрительский экран клуба) писался ДО формы арены и
-- дожил до сегодня со своим куском:
--       if b.terrain is null then
--         update battles set terrain = _bt_gen_terrain(id) ...
-- То есть генерит ландшафт, НЕ создав ни формы, ни спавна. А `_bt_zblob`
-- берёт размеры доски из формы: `coalesce((sh->>'w')::int, 1)` — при shape
-- null это доска 1×1, и весь ландшафт схлопывается в один гекс.
-- Живая дуэль ef3e3b32 в базе именно такая: terrain = {"0:0":"ast"}.
--   Дальше срабатывает вторая ступень: `_bt_ensure_field` видит shape null
-- ПРИ непустом terrain, считает бой «начатым до ревизии формы» (legacy) и
-- фиксирует его прямоугольным, оставляя spawn null. Арена окончательно
-- становится голым квадратом — и уже не чинится сама.
--   Достаточно, чтобы кто-то заглянул на зрительский экран раньше, чем
-- дуэлянт открыл доску. Порядок открытия экранов решал, будет ли карта.
--
-- ПОЧЕМУ НЕ ПЕРЕКАТИТЬ _fight_club.sql: там та же старая версия функции —
-- накат вернул бы поломку. Тело ниже собрано из ЖИВОГО prosrc, изменены
-- ровно две вещи (см. §1). Правило из [[fc-deploy-budget-ready-split]].
--
-- ЦЕПОЧКА: ПОСЛЕ _fight_club.sql, _bt_arena_shape.sql, _bt_arena_zoning.sql.
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §1. Зрительский экран собирает поле правильно ───────────
-- Изменено против живой версии:
--   1) блок «terrain is null → _bt_gen_terrain» заменён на _bt_ensure_field
--      (форма → спавн → ландшафт, в правильном порядке);
--   2) в ответ добавлены 'shape' и 'spawn' — их рисует клиент (battle_board.js
--      bbShape/bbSpawn). Без них зритель видел прямоугольник даже у здорового
--      боя, где форма в базе есть.
create or replace function public.fc_watch_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare b record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);           -- взвести размер доски этого боя
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.kind <> 'duel' then raise exception 'зрительский режим — только для дуэлей клуба'; end if;

  -- поле боя целиком: форма арены, сектора подхода, ландшафт
  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'my_side', 'spectator', 'my_fid', null,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', false,
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', true, 'def_ready', true,
    'deadline_at', b.deadline_at,
    'can_force', false,
    'winner', b.winner_fid,
    'interdicted', false,
    'log', b.log,
    'shape', b.shape, 'spawn', b.spawn,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', '[]'::jsonb,
    -- зрители видят ВСЁ: дуэль — это шоу, туман войны тут неуместен
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'side', u.side, 'mine', false,
        'fid', u.fid, 'fname', public._war_nm(u.fid),
        'name', u.unit_name, 'cls', u.cls,
        'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
        'hp', round(u.hp), 'max_hp', round(u.max_hp),
        'shield', round(u.shield), 'max_shield', round(u.max_shield),
        'armor', round(u.armor), 'dmg', round(u.dmg),
        'speed', u.speed, 'rng', u.rng,
        'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
        'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
        'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
        'locked', true, 'wpn', null,
        'moved', u.moved, 'fired', u.fired, 'acted', u.acted) order by u.created_at), '[]'::jsonb)
      from public.battle_units u where u.battle_id = p_battle and u.alive));
end$fn$;
grant execute on function public.fc_watch_state(uuid) to authenticated;

-- ── §2. Починка уже испорченных боёв ────────────────────────
-- Признак порчи: ландшафта фактически нет (0–1 гекс) ИЛИ нет секторов спавна.
-- Чиним ТОЛЬКО те бои, где на доске ещё никто не стоит: пересобранная арена
-- под уже расставленными бортами вырезала бы землю у них из-под киля.
do $$
declare r record; n int := 0;
begin
  for r in
    select b.id from public.battles b
     where b.status in ('forming','live')
       and not exists (select 1 from public.battle_units u where u.battle_id = b.id)
       and (b.spawn is null
            or coalesce(case when jsonb_typeof(b.terrain) = 'object'
                             then (select count(*) from jsonb_object_keys(b.terrain))
                             when jsonb_typeof(b.terrain) = 'array'
                             then jsonb_array_length(b.terrain)::bigint end, 0) <= 1)
  loop
    update public.battles set shape = null, spawn = null, terrain = null where id = r.id;
    perform public._bt_ensure_field(r.id);
    n := n + 1;
  end loop;
  raise notice 'арена пересобрана у % боёв', n;
end $$;
