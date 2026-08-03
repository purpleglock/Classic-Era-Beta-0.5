-- ═══════════════════════════════════════════════════════════════════
-- 🤖 РОСТЕР БОТОВ ПО ДЕРЖАВЕ: боты берут ТОЛЬКО её проекты
--
-- Было: admin_bot_battle набирал ботам ЛЮБЫЕ опубликованные ship-проекты
-- (весь каталог, кроме ростера клуба). Поэтому «пиратский» бой с Железным
-- Дивизионом выходил сборной солянкой: в ростер попадали и общедоступные
-- (faction_id is null) учебные корабли, и проекты чужих держав.
--
-- Стало: у бот-боя появился параметр p_bot_fid — id державы-ростера.
--   • задан  → боты берут СТРОГО проекты этой державы (faction_id = p_bot_fid).
--              Общедоступные (faction_id is null) и чужие НЕ берутся: держава
--              «может строить» публичные проекты, но ИИ-противник должен
--              выглядеть как она сама.
--   • пусто  → ростер ПО УМОЛЧАНИЮ = _bt_bot_roster_default() (Железный
--              Дивизион, пиратская вольница) — обычный ИИ-противник теста.
--   • '*'    → прежнее поведение: весь каталог, кроме ростера клуба.
-- p_bot_ship (один проект на всех) по-прежнему главнее всего.
--
-- Выбранный ростер запоминается в admin_bot_duel.bot_fid и отдаётся в
-- admin_bot_battle_state, чтобы админка показывала, кем сейчас играют боты.
--
-- ПОРЯДОК: после _admin_bot_battle.sql. Идемпотентно.
-- ═══════════════════════════════════════════════════════════════════

alter table public.admin_bot_duel add column if not exists bot_fid text;

-- Ростер ботов по умолчанию: Железный Дивизион (пиратская вольница).
-- Менять ИИ-противника теста — здесь, одним местом.
create or replace function public._bt_bot_roster_default() returns text
language sql stable as $$ select 'fac_5bfbfad5f8' $$;

-- Старая 3-аргументная сигнатура сносится: иначе PostgREST не разрешит вызов
-- по именованным параметрам (обе перегрузки подходят под {p_n}).
drop function if exists public.admin_bot_battle(uuid, uuid, int);

create or replace function public.admin_bot_battle(p_my_ship uuid default null,
                                                   p_bot_ship uuid default null,
                                                   p_n int default 3,
                                                   p_bot_fid text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; bot text := public._bt_bot_fid();
        sys text; bid uuid; old uuid;
        sb jsonb; bship uuid; i int; placed int := 0;
        bships uuid[]; nb_ships int;
        -- держава-ростер: пусто → дефолт (Железный Дивизион), '*' → весь каталог
        rf text := case when btrim(coalesce(p_bot_fid,'')) in ('*','all') then null
                        else coalesce(nullif(btrim(coalesce(p_bot_fid,'')), ''),
                                      public._bt_bot_roster_default()) end;
        -- держава названа явно? тогда пустой ростер — ошибка, а не тихий откат
        rf_expl boolean := nullif(btrim(coalesce(p_bot_fid,'')), '') is not null
                           and btrim(p_bot_fid) not in ('*','all');
        n int := least(80, greatest(1, coalesce(p_n,3)));
        w int := public._bt_wbig(); h int := public._bt_hbig(); yy int;
        percol int; coff int; ridx int;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;
  if me = bot then raise exception 'fid игрока совпал с fid бота — поменяйте _bt_bot_fid()'; end if;

  -- снести прошлый бот-бой целиком
  select battle_id into old from public.admin_bot_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  -- фаза расстановки: ты (att_ready=false) раскладываешь сам, боты уже готовы
  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             att_turns_left, def_turns_left, deadline_at)
    values (sys, me, bot, 'forming', 'meeting', false, true, 'attacker', 0, public._bt_acts(),
            6, 6, null)
    returning id into bid;
  -- РАЗНЫЕ корабли ботам: собираем перемешанный список ship-проектов и раздаём
  -- по одному — пока хватает уникальных, дальше по кругу. Так у ботов смешанный
  -- состав (разные классы и снаряжение), а не клоны.
  if p_bot_ship is not null then
    bships := array[p_bot_ship];                      -- принудительно один проект на всех
    rf := null;                                       -- один проект на всех — ростер ни при чём
  elsif rf is not null then
    -- СТРОГО проекты этой державы: без общедоступных (faction_id is null) и без чужих
    select array_agg(id order by random()) into bships
      from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
       and faction_id = rf;
    if coalesce(array_length(bships, 1), 0) = 0 then
      if rf_expl then
        raise exception 'у державы «%» нет своих опубликованных кораблей (ship с hp>0) — ботам нечем воевать',
          coalesce(nullif(public._war_nm(rf),''), rf);
      end if;
      -- дефолтная держава осталась без кораблей — не ломаем инструмент, берём каталог
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
       -- ростер Бойцовского клуба — только для арены, в бот-бои не выдаём
       and coalesce(faction_id,'') <> 'club';
  end if;
  nb_ships := coalesce(array_length(bships, 1), 0);
  if nb_ships = 0 then raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов'; end if;

  perform public._bt_log(bid, '🤖 Тестовый бой с ботами'
    || case when rf is not null
            then ' · ростер державы «' || coalesce(nullif(public._war_nm(rf),''), rf) || '» (только её проекты)'
            else '' end
    || '. Ты — нападающий (слева): расставь свой флот из полного каталога и жми «В бой». '
    || 'Боты уже стоят справа.');

  -- боты у своего (правого) края. При большом числе бортов заполняем несколько
  -- колонок вглубь, чтобы не налезали.
  percol := greatest(1, h / 2);
  for i in 1..n loop
    coff := (i - 1) / percol;                       -- смещение колонки вглубь от края
    ridx := (i - 1) % percol;                        -- строка в колонке
    yy := least(h-1, greatest(0, ridx * 2 + (coff % 2)));

    bship := bships[((i - 1) % nb_ships) + 1];        -- разные проекты, потом по кругу
    sb := public._bt_stats(bship);
    if sb is null then continue; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil)
      values (bid, bot, 'defender', bship, sb->>'name', sb->>'cls', greatest(w/2+1, w-2-coff), yy,
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        3, public._bt_turnneed(sb->>'cls'),
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
revoke all on function public.admin_bot_battle(uuid,uuid,int,text) from public;
grant execute on function public.admin_bot_battle(uuid,uuid,int,text) to authenticated;

-- ── состояние: добавлен ростер (кем играют боты) ─────────────────────
create or replace function public.admin_bot_battle_state()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t record; b record;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select * into t from public.admin_bot_duel where one = 1;
  if t.battle_id is null then return jsonb_build_object('battle_id', null); end if;
  select * into b from public.battles where id = t.battle_id;
  if b.id is null then return jsonb_build_object('battle_id', null); end if;
  return jsonb_build_object('battle_id', t.battle_id,
    'status', b.status, 'side_to_move', b.side_to_move,
    'winner', public._war_nm(b.winner_fid),
    'bot_fid', t.bot_fid,
    'bot_fname', case when t.bot_fid is null then null
                      else coalesce(nullif(public._war_nm(t.bot_fid),''), t.bot_fid) end,
    'bot_turn', ((b.side_to_move='attacker' and b.attacker_fid=public._bt_bot_fid())
              or (b.side_to_move='defender' and b.defender_fid=public._bt_bot_fid())));
end$$;
revoke all on function public.admin_bot_battle_state() from public;
grant execute on function public.admin_bot_battle_state() to authenticated;

notify pgrst, 'reload schema';

-- Проверка:
--   select public.admin_bot_battle(null, null, 6, 'fac_5bfbfad5f8');
--   → на доске только корабли Железного Дивизиона (6 пиратов + её собственные проекты)
