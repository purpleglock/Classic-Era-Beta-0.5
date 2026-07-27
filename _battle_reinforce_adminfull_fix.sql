-- ФИКС: подкрепление в админском бою с ботом падало «подкрепления нет на поле
-- боя — его нужно сначала привезти в систему».
--
-- Та же природа, что и у battle_deploy: battle_pool.is_full отдаёт полный
-- каталог (free=99) минуя battle_fleets, а live battle_reinforce всегда сверял
-- резерв по battle_fleets (в бот-бою он пуст) → free-used<=0 → отказ. Плюс в
-- бот-бою спавн должен быть свободным: без требования свежего хода, не тратя
-- ход и с кораблём, сразу готовым действовать. Тело взято из _admin_bot_battle.sql
-- (там уже была исправленная версия), патчим ТОЛЬКО эту функцию.
create or replace function public.battle_reinforce(p_battle uuid, p_unit_id uuid, p_y int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; st jsonb; free int; used int; px int; py int; cnt int; fc int;
        is_full boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := public._bt_side(p_battle, me);
  is_full := public._bt_admin_full(p_battle);   -- админский спавн из полного каталога

  st := public._bt_stats(p_unit_id);
  if st is null then raise exception 'проект корабля не найден'; end if;

  if public._bt_interdicted(p_battle, sd)
     and not coalesce((st->>'ftl')::bool, false) then
    raise exception 'подкрепление заблокировано полем интердикции: у врага работает FTL-заградитель. Уничтожьте его носителя, выведите корабль со стабилизационным полем «Альтаан» или вызовите корабль с собственным FTL-гипердвигателем';
  end if;

  -- в админском бот-бою спавн свободный: без требования свежего хода и без траты хода
  if not is_full and b.acts_left < public._bt_acts() then
    raise exception 'подкрепление вызывается только свежим ходом: оно стоит всех % активаций. Сейчас часть хода уже потрачена', public._bt_acts();
  end if;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me and alive;
  if cnt >= public._bt_cap() then raise exception 'на доске уже % кораблей', public._bt_cap(); end if;

  -- проверку «есть ли в резерве» пропускаем при админском полном каталоге
  if not is_full then
    select coalesce(sum(greatest(0, coalesce((c->>'qty')::int,0))), 0) into free
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where bf.battle_id = p_battle and bf.fid = me and (c->>'unit_id')::uuid = p_unit_id;
    select count(*) into used from public.battle_units
      where battle_id = p_battle and fid = me and unit_id = p_unit_id;
    if free - used <= 0 then
      raise exception 'подкрепления нет на поле боя — его нужно сначала привезти в систему';
    end if;
  end if;

  fc := case when sd = 'attacker' then 0 else 3 end;

  px := case when sd = 'attacker' then 0 else public._bt_w() - 1 end;
  py := greatest(0, least(public._bt_h() - 1, coalesce(p_y, public._bt_h() / 2)));
  select g into py from generate_series(0, public._bt_h()-1) g
    where not exists(select 1 from public.battle_units
                      where battle_id=p_battle and alive and x=px and y=g)
    order by abs(g - py), g
    limit 1;
  if py is null then raise exception 'некуда вывести подкрепление — край доски занят'; end if;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired, acted,
      facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
      dejam, eccm, interdict, stabil, ftl)
    values (p_battle, me, sd, p_unit_id, st->>'name', st->>'cls', px, py,
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
      (st->>'speed')::int, (st->>'rng')::int, not is_full, not is_full, not is_full,
      fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
      st->'wpn', st->'resist',
      coalesce((st->>'pd')::numeric,0), coalesce((st->>'jam')::int,0), coalesce((st->>'wings')::int,0),
      coalesce((st->>'dejam')::int,0), coalesce((st->>'eccm')::int,0),
      coalesce((st->>'interdict')::bool,false), coalesce((st->>'stabil')::bool,false),
      coalesce((st->>'ftl')::bool,false));

  perform public._bt_log(p_battle, format('%s вызывает подкрепление: %s', public._war_nm(me), st->>'name'));
  -- в бот-бою спавн не тратит ход (корабль уже готов действовать); в обычном бою — стоит хода
  if not is_full then
    perform public.battle_end_turn(p_battle);
  end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.battle_reinforce(uuid,uuid,int) from public;
grant execute on function public.battle_reinforce(uuid,uuid,int) to authenticated;
