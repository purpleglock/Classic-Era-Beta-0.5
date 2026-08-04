-- Бойцовский клуб: ставка только на ОДНУ сторону.
-- Рев.7 разрешала держать ставку на обоих дуэлянтов (кап считался на сторону),
-- то есть можно было выкупить обе кассы и выйти в плюс при любом исходе.
-- Факт из базы: в событии 65f5f310 fac_26f25b449f стоял и на 63c33ef6d5, и на
-- 3ec740393d. Теперь сторона фиксируется первой ставкой; докидывать можно
-- только на неё, до капа.
create or replace function public.fc_bet(p_on text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; ev record; amt numeric; old record; other record; have numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1 for update;
  if ev.status <> 'live' then raise exception 'ставки принимаются только во время дуэли'; end if;
  if (select status from public.battles where id = ev.battle_id) = 'forming' then
    raise exception 'дуэлянты ещё расставляют флот — ставки откроются с началом боя';
  end if;
  if (select status from public.battles where id = ev.battle_id) = 'done' then
    raise exception 'бой окончен — кассы закрыты';
  end if;
  if me in (ev.duelist_a, ev.duelist_b) then
    raise exception 'дуэлянтам ставить нельзя — вы и есть ставка';
  end if;
  if p_on is null or p_on not in (ev.duelist_a, ev.duelist_b) then
    raise exception 'ставить можно только на одного из дуэлянтов';
  end if;
  amt := floor(coalesce(p_amount, 0));
  if amt <= 0 then raise exception 'ставка должна быть больше нуля'; end if;

  -- рев.9: одна сторона на событие. Ставка на второго — отказ.
  select * into other from public.fc_bets
   where event_id = ev.id and fid = me and on_fid <> p_on limit 1;
  if other.fid is not null then
    raise exception 'вы уже поставили на %, на обоих дуэлянтов ставить нельзя',
      public._war_nm(other.on_fid);
  end if;

  -- Кап — на сторону (сторона теперь одна, но арифметика та же).
  select * into old from public.fc_bets where event_id = ev.id and fid = me and on_fid = p_on;
  if coalesce(old.amount, 0) + amt > public._fc_bet_cap() then
    raise exception 'кап ставки — % ГС', public._fc_bet_cap()::bigint;
  end if;

  select gc into have from public.faction_economy where faction_id = me for update;
  if coalesce(have, 0) < amt then raise exception 'не хватает средств: нужно % ГС', amt::bigint; end if;
  update public.faction_economy set gc = gc - amt where faction_id = me;

  insert into public.fc_bets(event_id, fid, on_fid, amount)
    values (ev.id, me, p_on, amt)
    on conflict (event_id, fid, on_fid) do update set amount = public.fc_bets.amount + excluded.amount;

  return jsonb_build_object('ok', true, 'amount', coalesce(old.amount,0) + amt);
end$$;
revoke all on function public.fc_bet(text, numeric) from public;
grant execute on function public.fc_bet(text, numeric) to authenticated;
