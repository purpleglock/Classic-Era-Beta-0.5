-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ»: ФАЗА ВОПЛОЩЕНИЯ ВИДНА НА ДОСКЕ (pk.ph)
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_phase2.sql и _angel_pk_look.sql.
-- Надмножество `battle_state` (сам файл — копия _angel_pk_look.sql плюс `ph`).
-- ⚠️ Правки battle_state вести ОТСЮДА.
--
-- ЗАЧЕМ. Второе тело отличается от первого не цифрами в сводке, а обликом:
-- медь вместо кости, шипы на ободьях, венец, доли плоти (см. angel_fx.js).
-- Спрайту нужна фаза, а доске её никто не передавал: `angel_status` живёт на
-- карте галактики, в бой она не ходит. Без ключа игрок, который дерётся со
-- ВТОРЫМ воплощением, видит на доске ПЕРВОЕ — то самое, которое он уже убил.
--
-- ⚠️ ЭТО КЛЮЧ ОБЛИКА, А НЕ СОСТОЯНИЯ. `ph` — это 1 или 2, ровно то, что видно
-- глазами с любой орбиты. Печати, плоть и перезарядки по-прежнему только своей
-- стороне.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.battle_state(p_battle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО battle_state (см. _angel_pk_look.sql).
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'tp_max', public._bt_tp_max(),
    'shape', b.shape, 'spawn', b.spawn,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    -- Кто ещё сидит на моей стороне (арена клуба сажает до трёх держав):
    -- по этому списку доска решает, «завершить ход» на кнопке или «готов».
    'mates', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', f, 'name', public._war_nm(f),
                 'ready', coalesce(b.turn_pass, '[]'::jsonb) ? f,
                 'me', (f = me)) order by f), '[]'::jsonb)
                from unnest(public._bt_side_actors(p_battle, sd)) f),
    'i_ready', (b.side_to_move = sd and coalesce(b.turn_pass, '[]'::jsonb) ? me),
    'wait_for', to_jsonb(public._bt_pass_wait(p_battle)),
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', b.att_ready, 'def_ready', b.def_ready,
    'deadline_at', b.deadline_at,
    'can_force', (b.status='active' and b.side_to_move is distinct from sd
                  and b.deadline_at is not null and b.deadline_at <= now()),
    'winner', b.winner_fid,
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'graves', (select coalesce(jsonb_agg(g), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(b.graves,'[]'::jsonb)) g
                where coalesce((g->>'t')::int, 0) >= b.turn_no - 1),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'fid', u.fid, 'fname', public._war_nm(u.fid),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield, 1), 'mitig', round(u.mitig), 'reduc', u.reduc,
            'stance', u.stance, 'tp', round(u.tp, 1), 'tp_max', round(u.tp_max, 1),
            'step_cost', round(public._bt_step_cost(u.speed), 2),
            'fire_cost', round(public._bt_fire_cost(u.cls), 2),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'acts', case when u.side = sd then coalesce(u.acts, '[]'::jsonb) else null end)
          || jsonb_build_object(
            'deb',   coalesce(u.deb, '{}'::jsonb),
            'hard',  u.hard, 'pdb', u.pdb,
            'rapid', u.rapid, 'sammo', u.sammo,
            'perks', coalesce(u.perks, '[]'::jsonb),
            'guard', u.guard, 'cloak', u.cloak, 'blind', u.blind,
            'mcd',  case when u.side = sd then coalesce(u.mcd, '{}'::jsonb) else null end,
            -- ⚠️ ЧУЖОМУ — ТОЛЬКО ОБЛИК. Раньше здесь стоял null для всей чужой
            -- стороны, и это резало не секреты, а КАРТИНКУ: метка `gd` (кто
            -- перед тобой — Херувим или Офаним) и ступень свечения ковчега
            -- `dim` живут в pk, поэтому враг видел подобия обычными кораблями,
            -- а ковчег — всегда одинаково ярким. Отдаём ровно эти два ключа:
            -- ими ничего не посчитать, они и есть то, что глазами видно.
            -- Всё остальное (перехват hj, счётчик попаданий ang, разгон ride)
            -- по-прежнему только своим.
            -- ⚠️ + `ph` (ФАЗА ВОПЛОЩЕНИЯ). Такой же ключ облика, как gd и dim:
            -- по нему спрайт выбирает палитру и габарит второго тела. Считается
            -- НЕ из pk (там его никто не ставил), а прямо из angel_state — так
            -- он верен и для бортов, залетевших на доску до этого наката.
            'pk',   case when u.side = sd then coalesce(u.pk, '{}'::jsonb)
                           || case when u.cls = 'angel'
                                then jsonb_build_object('ph', public._angel_phase(u.fid))
                                else '{}'::jsonb end
                    else jsonb_strip_nulls(jsonb_build_object(
                           'gd',  u.pk->'gd',
                           'dim', u.pk->'dim',
                           'ph',  case when u.cls = 'angel'
                                    then to_jsonb(public._angel_phase(u.fid)) end)) end,
            'amp',  case when u.side = sd then u.amp else null end,
            'resist', u.resist,
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
end$function$;
