-- ФИКС: расстановка в админском бою с ботом падала «таких кораблей в бою
-- больше нет».
--
-- Причина: battle_pool имеет ветку _bt_admin_full — для своей стороны стаффа
-- она отдаёт ВЕСЬ опубликованный ship-парк с free=99, минуя battle_fleets
-- (в таком бою скованных флотов нет). А живой battle_deploy этой ветки НЕ имел
-- и всегда сверял резерв по battle_fleets → free=0 → used(0)>=0 → отказ на
-- первом же корабле. Исправленный deploy лежал в _admin_bot_battle.sql, но тот
-- файл не применён; здесь патчим ТОЛЬКО battle_deploy, чтобы не тянуть всю
-- непринятую цепочку. Тело идентично живой функции + пропуск проверки резерва
-- при is_full.
create or replace function public.battle_deploy(p_battle uuid, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; e jsonb; uid uuid; st jsonb;
        cnt int; free int; used int; px int; py int; n int := 0; z int := public._bt_zone();
        fc int; is_full boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);           -- взвести размер доски этого боя
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'состав уже утверждён — бой идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if (sd = 'attacker' and b.att_ready) or (sd = 'defender' and b.def_ready) then
    raise exception 'вы уже подтвердили состав';
  end if;
  is_full := public._bt_admin_full(p_battle);   -- админский полный каталог
  fc := case when sd = 'attacker' then 0 else 3 end;   -- курс: к врагу

  delete from public.battle_units where battle_id = p_battle and fid = me;

  for e in select value from jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) loop
    uid := nullif(e->>'unit_id','')::uuid;
    px  := coalesce((e->>'x')::int, -1);
    py  := coalesce((e->>'y')::int, -1);
    if uid is null then continue; end if;
    if py < 0 or py >= public._bt_h() then raise exception 'гекс вне доски'; end if;
    if sd = 'attacker' and (px < 0 or px >= z) then
      raise exception 'нападающий разворачивается в % левых колонках', z;
    end if;
    if sd = 'defender' and (px < public._bt_w() - z or px >= public._bt_w()) then
      raise exception 'обороняющийся разворачивается в % правых колонках', z;
    end if;

    -- проверку «есть ли в резерве» пропускаем при админском полном каталоге
    if not is_full then
      select coalesce(sum(greatest(0, coalesce((c->>'qty')::int,0))), 0) into free
        from public.battle_fleets bf
        join public.fleets f on f.id = bf.fleet_id
        cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
       where bf.battle_id = p_battle and bf.fid = me and (c->>'unit_id')::uuid = uid;
      select count(*) into used from public.battle_units
        where battle_id = p_battle and fid = me and unit_id = uid;
      if used >= free then raise exception 'таких кораблей в бою больше нет: «%»', coalesce(e->>'unit_name','проект'); end if;
    end if;

    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = px and y = py) then
      raise exception 'гекс %:% уже занят — на одном гексе один корабль', px, py;
    end if;

    st := public._bt_stats(uid);
    if st is null then raise exception 'проект корабля не найден'; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, me, sd, uid, st->>'name', st->>'cls', px, py,
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
        (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
        (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
        st->'wpn', st->'resist',
        coalesce((st->>'pd')::numeric,0), coalesce((st->>'jam')::int,0), coalesce((st->>'wings')::int,0),
        coalesce((st->>'dejam')::int,0), coalesce((st->>'eccm')::int,0),
        coalesce((st->>'interdict')::bool,false), coalesce((st->>'stabil')::bool,false),
        coalesce((st->>'ftl')::bool,false));
    n := n + 1;
    if n > public._bt_cap() then raise exception 'в бой можно вывести не больше % кораблей', public._bt_cap(); end if;
  end loop;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  return jsonb_build_object('ok', true, 'deployed', cnt);
end$$;
revoke all on function public.battle_deploy(uuid,jsonb) from public;
grant execute on function public.battle_deploy(uuid,jsonb) to authenticated;
