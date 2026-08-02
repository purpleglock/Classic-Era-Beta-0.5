-- Уборка осиротевших пул-флотов Бойцовского клуба.
-- Причина: пул («Резерв Бойцовского клуба», fleets.status='duel') гасился только
-- в двух ветках — при подтверждении состава (battle_ready) и при таймауте
-- расстановки (_fc_settle). При ШТАТНОМ финале дуэли (сторона уничтожена)
-- невыставленные резервы оставались навсегда: накопилось 12 сирот у fac_364f438c67,
-- fac_5bfbfad5f8, fac_b0b54c37a7, fac_26f25b449f.
-- Пул самодостаточен (состав в fleets.composition, дочерних строк нет) —
-- удаление безопасно.
-- Зеркало: те же функции в _fight_club.sql (источник правды).

-- ── Подметалка ──────────────────────────────────────────────
-- Сносит пул, если у него нет строки в battle_fleets вообще либо связанный бой
-- уже status='done'. Пулы живых боёв (forming/active) НЕ трогает, поэтому
-- вызывать безопасно из любого места.
create or replace function public._fc_sweep_pools()
returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  with dead as (
    delete from public.fleets f
     where f.status = 'duel'
       and f.name = 'Резерв Бойцовского клуба'
       and not exists (
         select 1 from public.battle_fleets bf
           join public.battles b on b.id = bf.battle_id
          where bf.fleet_id = f.id and b.status <> 'done')
    returning 1)
  select count(*) into n from dead;
  return n;
end$$;
revoke all on function public._fc_sweep_pools() from public;

-- ── _fc_settle с уборкой при штатном завершении ─────────────
create or replace function public._fc_settle(p_event uuid)
returns void language plpgsql security definer set search_path=public as $$
declare ev record; b record; win text; lose text;
        pool_win numeric; pool_lose numeric; bank numeric; r record; pay numeric;
        prz numeric;
begin
  select * into ev from public.fc_events where id = p_event for update;
  if ev.id is null or ev.status <> 'live' or ev.settled then return; end if;
  select * into b from public.battles where id = ev.battle_id;
  if b.id is null then
    -- бой пропал (система удалена и т.п.) — вернуть все ставки и закрыть круг
    for r in select * from public.fc_bets where event_id = p_event loop
      update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
      update public.fc_bets set won = r.amount
        where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
    end loop;
    update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
    perform public._fc_sweep_pools();
    return;
  end if;

  -- рев.8: таймаут расстановки. Кто не расставился и не нажал «в бой» до
  -- дедлайна — техническое поражение. Если оба промолчали — дуэль не состоялась.
  if b.status = 'forming' and b.deadline_at is not null and b.deadline_at <= now() then
    -- гасим невыставленные резервы обеих сторон (синтетические пул-флоты)
    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = b.id and bf.fleet_id = f.id;
    if b.att_ready and not b.def_ready then
      update public.battles set status='done', winner_fid=b.attacker_fid, ended_at=now()
       where id = b.id;
      perform public._bt_log(b.id, format('⏳ %s не расставил флот — техническое поражение. Победа %s.',
        public._war_nm(b.defender_fid), public._war_nm(b.attacker_fid)));
    elsif b.def_ready and not b.att_ready then
      update public.battles set status='done', winner_fid=b.defender_fid, ended_at=now()
       where id = b.id;
      perform public._bt_log(b.id, format('⏳ %s не расставил флот — техническое поражение. Победа %s.',
        public._war_nm(b.attacker_fid), public._war_nm(b.defender_fid)));
    else
      -- никто не расставился — дуэль не состоялась: возврат ставок, новый круг
      for r in select * from public.fc_bets where event_id = p_event loop
        update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
        update public.fc_bets set won = r.amount
          where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
      end loop;
      update public.battles set status='done', ended_at=now() where id = b.id;
      update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
      perform public._fc_news('🥊 Бойцовский клуб: дуэль не состоялась',
        format('%s и %s не вышли на арену в срок — круг отменён, ставки возвращены.',
          public._war_nm(ev.duelist_a), public._war_nm(ev.duelist_b)),
        jsonb_build_array(ev.duelist_a, ev.duelist_b));
      insert into public.fc_events(status, signup_until)
        values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
      return;
    end if;
    select * into b from public.battles where id = ev.battle_id;   -- перечитать вердикт
  end if;

  if b.status <> 'done' or b.winner_fid is null then return; end if;

  -- бой завершён штатно (сторона уничтожена) — гасим оставшиеся пул-флоты
  -- обеих сторон. Раньше уборка была только в ветке таймаута выше, поэтому
  -- невыставленные резервы копились у держав навсегда.
  perform public._fc_sweep_pools();

  win  := b.winner_fid;
  lose := case when win = ev.duelist_a then ev.duelist_b else ev.duelist_a end;
  select coalesce(sum(amount) filter (where on_fid = win), 0),
         coalesce(sum(amount) filter (where on_fid <> win), 0)
    into pool_win, pool_lose
    from public.fc_bets where event_id = p_event;
  bank := pool_lose + ev.npc_bet;

  -- призовой кошель клуба: победителю дуэли ВСЕГДА (страховка coalesce/0 —
  -- на случай круга, стартовавшего до этой ревизии, где prize не записан)
  prz := coalesce(ev.prize, 0);
  if prz <= 0 then prz := public._fc_prize(); end if;
  update public.faction_economy set gc = gc + prz where faction_id = win;

  if pool_win > 0 then
    -- угадавшие: возврат ставки + доля банка пропорционально ставке
    for r in select * from public.fc_bets where event_id = p_event and on_fid = win loop
      pay := round(r.amount + bank * r.amount / pool_win);
      update public.faction_economy set gc = gc + pay where faction_id = r.fid;
      update public.fc_bets set won = pay
        where event_id = p_event and fid = r.fid and on_fid = win;
    end loop;
    update public.fc_bets set won = 0 where event_id = p_event and on_fid <> win;
  else
    -- никто не угадал — весь банк уходит победителю дуэли
    update public.faction_economy set gc = gc + bank where faction_id = win;
    update public.fc_bets set won = 0 where event_id = p_event;
  end if;

  update public.fc_events
     set status = 'done', settled = true, winner_fid = win, ended_at = now(),
         prize = prz
   where id = p_event;

  perform public._fc_news('🥊 Бойцовский клуб: вердикт арены',
    format('Дуэль окончена: %s разбивает %s. Победитель забирает приз клуба — %s ГС. Банк круга — %s ГС (в том числе %s ГС от анонимного мецената)%s.',
      public._war_nm(win), public._war_nm(lose), prz::bigint, bank::bigint, ev.npc_bet::bigint,
      case when pool_win > 0 then ' — разделён между угадавшими'
           else ' — тоже уходит победителю: не угадал никто' end),
    jsonb_build_array(win, lose));

  -- пауза: следующий круг открывается сразу, окно заявок = _fc_signup_hours() (6ч)
  insert into public.fc_events(status, signup_until)
    values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
end$$;
revoke all on function public._fc_settle(uuid) from public;

-- ── Разовая уборка накопившихся сирот ───────────────────────
-- Пулы активной дуэли b56052ef-3324-4c75-9c0b-8695c7ae5d0e (status='forming')
-- условие подметалки не задевает — они останутся на месте.
do $$
declare n int;
begin
  n := public._fc_sweep_pools();
  raise notice 'снесено осиротевших пул-флотов клуба: %', n;
end$$;
