-- ════════════════════════════════════════════════════════════
-- ПРИЗЫВ НЕЯВИВШЕЙСЯ СТОРОНЫ СТАВИЛ ФЛОТ МИМО СЕКТОРА ПОДХОДА
--
-- `_angel_free_hex` (_angel_floor.sql) искал место по СТАРОЙ разметке:
-- «нападающий — z левых колонок, обороняющийся — z правых». Но с
-- _bt_arena_shape.sql зона подхода — это КРУГ вокруг якоря (battles.spawn),
-- и он может оказаться где угодно на арене: курсы сторон разводятся на
-- 100-180°, якорь садится на кромку формы.
--
-- Итог на живом бою db3ab2ba (перехват в Гаттамелате): сектор нападающего
-- был в (2,35), а сервер выставил все семь бортов в (0..3, 0..1) — угол
-- доски, 40 гексов от противника и вне собственного сектора. Игрок видит
-- «флот другой стороны стоит хер знает где», а руками так поставить нельзя:
-- battle_deploy проверяет _bt_in_spawn и такой гекс не пропустит.
--
-- Стало: место берёт общий `_bt_spawn_free` (тот же, что у подкреплений) —
-- ближайший свободный гекс своего круга, с проверкой формы арены. Колонки
-- остаются запасным ходом для легаси-боёв, где spawn = null.
--
-- ПОРЯДОК: после _bt_arena_apply.sql (там живёт _bt_spawn_free). Идемпотентно.
-- ════════════════════════════════════════════════════════════

create or replace function public._angel_free_hex(p_battle uuid, p_side text)
returns int[] language plpgsql stable security definer set search_path=public as $$
declare z int; w int; h int; x0 int; x1 int; xi int; yi int; xy int[];
begin
  -- Новая арена: свой круг подхода. sd-ключ спавна — 'att'/'def'.
  xy := public._bt_spawn_free(p_battle, case when p_side = 'attacker' then 'att' else 'def' end);
  if xy is not null then return xy; end if;

  -- Легаси-бой без секторов: прежние колонки у края.
  z := public._bt_zone(); w := public._bt_w(); h := public._bt_h();
  if p_side = 'attacker' then x0 := 0; x1 := z - 1;
  else                       x0 := w - z; x1 := w - 1; end if;

  for yi in 0 .. h - 1 loop
    for xi in x0 .. x1 loop
      if not exists (select 1 from public.battle_units u
                      where u.battle_id = p_battle and u.alive and u.x = xi and u.y = yi) then
        return array[xi, yi];
      end if;
    end loop;
  end loop;
  return null;
end$$;
revoke all on function public._angel_free_hex(uuid, text) from public;

-- ── ПОДБОРКА УЖЕ БРОШЕННЫХ В УГОЛ ───────────────────────────
-- Стороны, у которых ВЕСЬ живой состав стоит вне своего круга подхода, —
-- это работа старого призыва. Переставляем их в свой сектор; сторону, где
-- хоть один борт стоит правильно, не трогаем (там расставлял игрок).
do $$
declare r record; u record; xy int[];
begin
  for r in
    select bu.battle_id, bu.side,
           case when bu.side = 'attacker' then 'att' else 'def' end as sk
      from public.battle_units bu
      join public.battles b on b.id = bu.battle_id
     where b.status <> 'done' and b.spawn is not null and bu.alive
     group by bu.battle_id, bu.side
    having bool_and(not coalesce(public._bt_in_spawn(
             (select b2.spawn from public.battles b2 where b2.id = bu.battle_id),
             case when bu.side = 'attacker' then 'att' else 'def' end, bu.x, bu.y), false))
  loop
    perform public._bt_arm(r.battle_id);
    for u in select id from public.battle_units
              where battle_id = r.battle_id and side = r.side and alive order by id loop
      xy := public._bt_spawn_free(r.battle_id, r.sk);
      exit when xy is null;
      update public.battle_units set x = xy[1], y = xy[2] where id = u.id;
    end loop;
    update public.battle_units bu
       set facing = public._bt_spawn_facing(b.spawn, r.side)
      from public.battles b
     where b.id = r.battle_id and bu.battle_id = r.battle_id and bu.side = r.side and bu.alive;
  end loop;
end$$;
