-- ════════════════════════════════════════════════════════════════════════
--  ЗАГРАЖДЕНИЯ: ФАНТОМНОЕ «ФЛОТ ВЫБИТ» → ВЕЧНЫЙ ПРОЛЁТ КАЖДЫЕ 5 МИНУТ
--
--  ЧТО БЫЛО. _hazard_pass считал потери ПО НАМЕРЕНИЮ, а не по факту:
--      l := least(ships, ...);  perform _fleet_kill_ships(p_fleet, l);
--      losses := losses + l;    ships := ships - l;
--  Но _fleet_kill_ships возвращает 0 для тех, кого по кораблям не считают:
--  ковчег «Престола» (урон по нему — только печати) и крылья Стражи (у них
--  рана вместо смерти). Флот оставался цел, а счётчик уходил в ноль —
--  и функция рапортовала wiped=true.
--
--  Дальше _fleet_settle на wiped делает `continue`: строку флота НЕ трогает,
--  потому что «его уже нет». Обычный флот к этому моменту и правда удалён.
--  Ковчег — нет: он остаётся status='transit' с arrive_at в прошлом, и
--  СЛЕДУЮЩИЙ ЖЕ тик (angel-ai-tick, раз в 5 минут) снова гонит его тем же
--  маршрутом. Мины и дроны срабатывают заново, каждое срабатывание пишет
--  ДВЕ новости (жертве и хозяину) — отсюда «Атака дронов: Изнанка» ×6 через
--  каждые пять минут и минус крыло с чужого поста за каждый холостой заход.
--
--  ЧТО СТАЛО.
--   • Потери считаются пересчётом состава ДО и ПОСЛЕ удара. Ноль потерь —
--     заграждение не оставило следа: заряд/крыло НЕ тратится, в ленту
--     ничего не пишется. Ковчег проходит мимо мин, как и задумано.
--   • wiped ставится, только если строки флота в самом деле больше нет.
--     Уцелевший флот всегда садится, и повторного пролёта не бывает.
--
--  Накатывать: node tools/db_run.js _hazard_phantom_wipe.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public._hazard_pass(p_fleet uuid, p_fid text, p_sys text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mf record; dp record; w boolean; ships int; before int; losses int := 0; l int;
        frac numeric; hi numeric; aa int; bound int; eff int; sysname text; gone boolean;
begin
  select coalesce(sum(greatest(0, (c->>'qty')::int)), 0) into ships
    from public.fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) c
   where f.id = p_fleet;
  if coalesce(ships, 0) <= 0 then return jsonb_build_object('losses', 0, 'wiped', false); end if;
  select coalesce(nullif(name, ''), id) into sysname from public.map_systems where id = p_sys;

  -- ── МИНЫ ──────────────────────────────────────────────────────────────
  for mf in select * from public.system_minefields
             where system_id = p_sys and planet_pid is null
               and faction_id is distinct from p_fid and hexes > 0
  loop
    begin select public.at_war(p_fid, mf.faction_id) into w;
    exception when undefined_function then w := false; end;
    if not coalesce(w, false) then continue; end if;
    if random() > public._hazard_const('hazard_chance') then continue; end if;

    hi   := least(1.0, public._hazard_const('mine_kill_per_chg') * mf.hexes);
    frac := public._hazard_const('mine_kill_base')
            + random() * greatest(0, hi - public._hazard_const('mine_kill_base'));
    before := ships;
    perform public._fleet_kill_ships(p_fleet, least(ships, greatest(1, round(ships * frac)::int)));

    -- ⚠️ ПО ФАКТУ, а не по намерению: ковчег и Стража кораблей не теряют.
    select coalesce(sum(greatest(0, (c->>'qty')::int)), 0) into ships
      from public.fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) c
     where f.id = p_fleet;
    l := greatest(0, before - ships);
    if l <= 0 then continue; end if;      -- следа нет → заряд цел, в ленту молчим

    losses := losses + l;
    update public.system_minefields set hexes = hexes - 1 where id = mf.id;
    delete from public.system_minefields where id = mf.id and hexes <= 0;
    perform public._hazard_news(p_fid, '💥 Подрыв на минах: ' || sysname,
      format('Флот напоролся на минные заграждения «%s» в системе %s. Потеряно кораблей: %s.',
             public._fac_name(mf.faction_id), sysname, l));
    perform public._hazard_news(mf.faction_id, '💥 Мины сработали: ' || sysname,
      format('Минное поле в системе %s подорвало флот «%s». Уничтожено кораблей: %s. Израсходован 1 заряд.',
             sysname, public._fac_name(p_fid), l));
    if ships <= 0 then exit; end if;
  end loop;

  -- ── ПОСТЫ ДРОНОВ ──────────────────────────────────────────────────────
  if ships > 0 then
  for dp in select * from public.system_drone_posts
             where system_id = p_sys and faction_id is distinct from p_fid and wings > 0
  loop
    begin select public.at_war(p_fid, dp.faction_id) into w;
    exception when undefined_function then w := false; end;
    if not coalesce(w, false) then continue; end if;

    aa    := public._fleet_aa_count(p_fleet);
    bound := least(dp.wings, floor(aa / public._hazard_const('drone_aa_per_wing'))::int);
    eff   := dp.wings - bound;
    -- ПРО сбивает связанные крылья — пост «худеет» в любом случае
    if bound > 0 then
      update public.system_drone_posts set wings = wings - bound where id = dp.id;
      perform public._hazard_news(dp.faction_id, '🛰 ПРО против дронов: ' || sysname,
        format('Зенитные расчёты флота «%s» сбили %s крыл. дронов поста в системе %s.',
               public._fac_name(p_fid), bound, sysname));
    end if;

    if eff > 0 and random() <= public._hazard_const('hazard_chance') then
      hi   := least(1.0, public._hazard_const('drone_kill_per_wing') * eff);
      frac := public._hazard_const('drone_kill_base')
              + random() * greatest(0, hi - public._hazard_const('drone_kill_base'));
      frac := least(1.0, frac);
      before := ships;
      perform public._fleet_kill_ships(p_fleet, least(ships, greatest(1, round(ships * frac)::int)));

      select coalesce(sum(greatest(0, (c->>'qty')::int)), 0) into ships
        from public.fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) c
       where f.id = p_fleet;
      l := greatest(0, before - ships);

      if l > 0 then
        losses := losses + l;
        update public.system_drone_posts set wings = wings - 1 where id = dp.id;  -- атака стоит крыла
        perform public._hazard_news(p_fid, '🛸 Атака дронов: ' || sysname,
          format('Пост дронов «%s» в системе %s растерзал флот: потеряно кораблей — %s.%s',
                 public._fac_name(dp.faction_id), sysname, l,
                 case when aa <= 0 then ' Во флоте не было ни одного ствола ПРО.' else '' end));
        perform public._hazard_news(dp.faction_id, '🛸 Дроны сработали: ' || sysname,
          format('Пост дронов в системе %s атаковал флот «%s». Уничтожено кораблей: %s.',
                 sysname, public._fac_name(p_fid), l));
      end if;
    end if;

    delete from public.system_drone_posts where id = dp.id and wings <= 0;
    if ships <= 0 then exit; end if;
  end loop;
  end if;

  -- ⚠️ Выбит — только если строки флота действительно не осталось. Иначе
  -- _fleet_settle пропустит посадку, и флот зависнет в вечном пролёте.
  gone := not exists (select 1 from public.fleets where id = p_fleet);
  return jsonb_build_object('losses', losses, 'wiped', gone);
end$$;
revoke all on function public._hazard_pass(uuid, text, text) from public;

-- ⚠️ Зависшие в пролёте флоты руками НЕ сажаем: _fleet_settle зовётся лениво
-- (fleets_mine/fleets_visible), и «просроченный» arrive_at — обычное дело для
-- офлайн-игрока. С починенным wiped такой флот сядет сам на первом же вызове.
