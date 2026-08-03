-- ════════════════════════════════════════════════════════════════════════
-- АРЕНА-ФОРМА: бот-бой
-- ────────────────────────────────────────────────────────────────────────
-- Катать после _bt_arena_shape.sql и _bt_arena_apply.sql.
-- Раньше боты вставали колонками у правого края доски. Теперь бой сначала
-- получает форму и сектора подхода, а боты занимают свой сектор изнутри
-- наружу — тем же правилом, по которому расставляется игрок.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.admin_bot_battle(p_my_ship uuid default null, p_bot_ship uuid default null,
                                                   p_n integer default 3, p_bot_fid text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; bot text := public._bt_bot_fid();
        sys text; bid uuid; old uuid;
        sb jsonb; bship uuid; i int; placed int := 0;
        bships uuid[]; nb_ships int;
        rf text := case when btrim(coalesce(p_bot_fid,'')) in ('*','all') then null
                        else coalesce(nullif(btrim(coalesce(p_bot_fid,'')), ''),
                                      public._bt_bot_roster_default()) end;
        rf_expl boolean := nullif(btrim(coalesce(p_bot_fid,'')), '') is not null
                           and btrim(p_bot_fid) not in ('*','all');
        n int := least(80, greatest(1, coalesce(p_n,3)));
        xy int[]; fc int; sp jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;
  if me = bot then raise exception 'fid игрока совпал с fid бота — поменяйте _bt_bot_fid()'; end if;

  select battle_id into old from public.admin_bot_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             att_turns_left, def_turns_left, deadline_at)
    values (sys, me, bot, 'forming', 'meeting', false, true, 'attacker', 0, public._bt_acts(),
            6, 6, null)
    returning id into bid;

  -- форма арены и векторы подхода — ДО расстановки ботов
  perform public._bt_ensure_field(bid);
  select b.spawn into sp from public.battles b where b.id = bid;
  fc := public._bt_spawn_facing(sp, 'defender');

  if p_bot_ship is not null then
    bships := array[p_bot_ship];
    rf := null;
  elsif rf is not null then
    select array_agg(id order by random()) into bships
      from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
       and faction_id = rf;
    if coalesce(array_length(bships, 1), 0) = 0 then
      if rf_expl then
        raise exception 'у державы «%» нет своих опубликованных кораблей (ship с hp>0) — ботам нечем воевать',
          coalesce(nullif(public._war_nm(rf),''), rf);
      end if;
      rf := null;
      select array_agg(id order by random()) into bships
        from public.faction_units
       where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
         and coalesce(faction_id,'') <> 'club';
    end if;
  else
    select array_agg(id order by random()) into bships
      from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
       and coalesce(faction_id,'') <> 'club';
  end if;
  nb_ships := coalesce(array_length(bships, 1), 0);
  if nb_ships = 0 then raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов'; end if;

  perform public._bt_log(bid, '🤖 Тестовый бой с ботами'
    || case when rf is not null
            then ' · ростер державы «' || coalesce(nullif(public._war_nm(rf),''), rf) || '» (только её проекты)'
            else '' end
    || '. Ты — нападающий: расставь свой флот из полного каталога в СВОЁМ секторе подхода и жми «В бой». '
    || 'Боты уже вошли в бой со своего вектора.');

  -- боты занимают свой сектор изнутри наружу
  for i in 1..n loop
    bship := bships[((i - 1) % nb_ships) + 1];
    sb := public._bt_stats(bship);
    if sb is null then continue; end if;
    xy := public._bt_spawn_free(bid, 'def');
    exit when xy is null;                     -- сектор забит — дальше некуда

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil)
      values (bid, bot, 'defender', bship, sb->>'name', sb->>'cls', xy[1], xy[2],
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        fc, public._bt_turnneed(sb->>'cls'),
        coalesce((sb->>'sensor')::int,0), coalesce((sb->>'stealth')::int,0),
        coalesce(sb->'wpn','[]'::jsonb), coalesce(sb->'resist','{}'::jsonb),
        coalesce((sb->>'pd')::numeric,0), coalesce((sb->>'jam')::int,0), coalesce((sb->>'wings')::int,0),
        coalesce((sb->>'dejam')::int,0), coalesce((sb->>'eccm')::int,0),
        coalesce((sb->>'interdict')::bool,false), coalesce((sb->>'stabil')::bool,false));
    placed := placed + 1;
  end loop;
  if placed = 0 then raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов'; end if;

  insert into public.admin_bot_duel(one, battle_id, bot_fid) values (1, bid, rf)
    on conflict (one) do update set battle_id = excluded.battle_id,
                                    bot_fid   = excluded.bot_fid,
                                    created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', bid, 'n', placed, 'phase', 'forming',
    'bot_fid', rf, 'bot_fname', case when rf is null then null
                                     else coalesce(nullif(public._war_nm(rf),''), rf) end);
end$$;
revoke all on function public.admin_bot_battle(uuid, uuid, integer, text) from public;
grant execute on function public.admin_bot_battle(uuid, uuid, integer, text) to authenticated;
