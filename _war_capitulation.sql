-- ════════════════════════════════════════════════════════════
-- КАПИТУЛЯЦИЯ И СРОК ОТВЕТА НА НОТЫ ВОЙНЫ (18.10.2026)
-- ------------------------------------------------------------
-- 1) У каждой ноты войны есть срок ответа — трое суток (expires_at).
--    Не ответили вовремя → обычная нота считается ОТКЛОНЁННОЙ.
-- 2) Новая нота 'capitulation' («Предложить капитуляцию»): шлёт зачинщик
--    стороны, когда держит (оккупирует) ≥ 80% систем противника.
--    Не ответили за трое суток → КАПИТУЛЯЦИЯ автоматически.
-- 3) Любая принятая капитуляция (surrender / demand_surrender / capitulation)
--    теперь ПЕРЕДАЁТ проигравшую державу целиком главе победившей стороны
--    (через _annex_merge). Союзники победителя ничего не получают —
--    делить добычу или нет, решает сам победитель.
-- 4) Игрок сдавшейся державы свободен: анкета уходит в 'capitulated',
--    он может зарегистрировать новую державу или пойти на службу в чужую.
-- 5) Планировщик war-offers-expire раз в час разбирает просроченные ноты.
-- Повторный запуск файла безопасен.
-- ════════════════════════════════════════════════════════════

-- ── Схема ────────────────────────────────────────────────────
alter table public.war_offers add column if not exists expires_at timestamptz;
alter table public.war_offers alter column expires_at set default now() + interval '3 days';
update public.war_offers set expires_at = now() + interval '3 days'
 where status = 'pending' and expires_at is null;

alter table public.war_offers drop constraint if exists war_offers_kind_ck;
alter table public.war_offers add constraint war_offers_kind_ck check (kind = any (array[
  'status_quo','surrender','demand_surrender','conference','call_ally','capitulation']));

-- ── Константы ────────────────────────────────────────────────
create or replace function public._war_cap_const(p_key text) returns numeric
language sql immutable as $$
  select case p_key
    when 'share'   then 0.80   -- доля систем противника под оккупацией для ноты
    when 'reply_h' then 72     -- срок ответа на любую ноту, часы
    else null end
$$;

-- ── Доля систем противника, которые держит p_holder ──────────
-- Знаменатель — все системы противника на карте (оккупированные остаются
-- за владельцем, поэтому входят в него). Числитель — те из них, где
-- оккупант p_holder. Колонии для порога не считаются: только системы.
create or replace function public._war_sys_share(p_holder text, p_foe text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when tot = 0 then 0 else round(held::numeric / tot, 4) end
  from (select (select count(*) from public.map_systems s where s.faction = p_foe) tot,
               (select count(*) from public.system_occupation o
                  join public.map_systems s on s.id = o.system_id and s.faction = p_foe
                 where o.occupier_fid = p_holder) held) q
$$;

-- ── Капитуляция: держава проигравшего уходит победителю ──────
create or replace function public._war_capitulate(p_war uuid, p_winner text, p_loser text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.wars; v_owner uuid; ow record; n_sys int; n_col int;
begin
  select * into w from public.wars where id = p_war for update;
  if w.id is null then raise exception 'no such war'; end if;
  if p_winner is null or p_loser is null or p_winner = p_loser then raise exception 'bad sides'; end if;

  select count(*) into n_sys from public.map_systems where faction = p_loser;
  select count(*) into n_col from public.colonies where faction_id = p_loser;
  select owner_id into v_owner from public.faction_applications
   where faction_id = p_loser and status = 'approved' order by updated_at desc limit 1;

  -- 1) Эта война — победой стороны p_winner
  if w.status = 'active' then
    update public.wars set status = case when p_winner = w.attacker_fid then 'attacker_won' else 'defender_won' end,
           ended_at = now(), outcome_note = coalesce(p_note, outcome_note)
     where id = p_war;
  end if;

  -- 2) Прочие войны, которые вёл проигравший как зачинщик, гаснут: державы больше нет
  for ow in select id from public.wars
             where status = 'active' and id <> p_war
               and (attacker_fid = p_loser or defender_fid = p_loser) loop
    update public.wars set status = 'status_quo', ended_at = now(),
           outcome_note = 'держава прекратила существование после капитуляции'
     where id = ow.id;
  end loop;
  -- …а там, где он был лишь союзником, просто выбывает
  delete from public.war_sides s using public.wars x
   where s.war_id = x.id and x.status = 'active' and s.fid = p_loser;

  -- 3) Все висящие ноты проигравшего и к нему — в архив
  update public.war_offers set status = 'expired', resolved_at = now()
   where status = 'pending' and (from_fid = p_loser or to_fid = p_loser
         or war_id in (select id from public.wars where status <> 'active'));

  -- 4) Оккупация: что держал победитель — теперь просто его; прочие оккупанты
  --    остаются, но владельцем становится победитель
  delete from public.system_occupation where owner_fid = p_loser and occupier_fid = p_winner;
  update public.system_occupation set owner_fid = p_winner where owner_fid = p_loser;
  delete from public.system_occupation where occupier_fid = p_loser;

  -- 5) Передача всего: системы, колонии, постройки, флоты, армии, казна, наука
  perform public._annex_merge(p_winner, p_loser, null::uuid);

  -- 6) Анкета проигравшего закрыта; игрок свободен
  update public.faction_applications set status = 'capitulated', updated_at = now()
   where faction_id = p_loser and status = 'approved';
  update public.faction_members set status = 'left', updated_at = now()
   where faction_id = p_loser and status in ('active','pending');
  begin
    update public.diplo_vassals set status = 'broken'
     where status in ('pending','active') and (vassal_fid = p_loser or overlord_fid = p_loser);
  exception when others then raise notice 'capitulate vassals: %', sqlerrm; end;
  begin
    update public.state_annexations set status = 'withdrawn'
     where status = 'pending' and (lead_fid = p_loser or minor_fid = p_loser);
  exception when others then raise notice 'capitulate annex: %', sqlerrm; end;
  begin
    delete from public.diplo_members where fid = p_loser;
  exception when others then raise notice 'capitulate unions: %', sqlerrm; end;

  perform public._war_news(
    '⚑ Капитуляция: ' || public._war_nm(p_loser) || ' → ' || public._war_nm(p_winner),
    public._news_pick(array[
      format('%s капитулирует перед державой %s. Под новый флаг уходят %s систем и %s колоний — флоты, склады и казна вместе с ними.',
             public._war_nm(p_loser), public._war_nm(p_winner), n_sys, n_col),
      format('Знамёна %s спущены навсегда. %s принимает капитуляцию и всё, что было у побеждённой державы: %s систем, %s колоний.',
             public._war_nm(p_loser), public._war_nm(p_winner), n_sys, n_col),
      format('Война окончена полной капитуляцией: держава %s прекращает существование, её земли отходят %s.',
             public._war_nm(p_loser), public._war_nm(p_winner))
    ]),
    (select coalesce(jsonb_agg(fid), '[]'::jsonb) from public.war_sides where war_id = p_war));

  return jsonb_build_object('ok', true, 'winner', p_winner, 'loser', p_loser,
                            'systems', n_sys, 'colonies', n_col, 'freed_owner', v_owner);
end $$;
revoke all on function public._war_capitulate(uuid, text, text, text) from public, anon, authenticated;

-- ── Отправка ноты ────────────────────────────────────────────
create or replace function public.war_offer_make__raw(p_war uuid, p_kind text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text; sd text; foe text; oid uuid; msg text; w record; sh numeric; exp timestamptz;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into w from public.wars where id = p_war;
  if w.id is null then raise exception 'no such war'; end if;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  sd := public._war_side_of(p_war, me);
  if sd is null then raise exception 'вы не участвуете в этой войне'; end if;
  if p_kind not in ('status_quo','surrender','demand_surrender','conference','capitulation') then
    raise exception 'bad kind';
  end if;
  -- Мир подписывают только зачинщики: иначе младший союзник вывел бы
  -- из войны всю коалицию.
  if p_kind <> 'conference' and not public._war_is_leader(p_war, me) then
    raise exception 'мирные ноты подписывает только зачинщик стороны';
  end if;

  msg := nullif(btrim(coalesce(p_message,'')),'');
  foe := case when sd = 'attacker' then w.defender_fid else w.attacker_fid end;

  -- «Предложить капитуляцию» — только когда под вашей оккупацией ≥ 80% систем противника
  if p_kind = 'capitulation' then
    sh := public._war_sys_share(me, foe);
    if sh < public._war_cap_const('share') then
      raise exception 'капитуляцию можно предложить, когда вы держите не меньше % %% систем противника (сейчас % %%)',
        round(public._war_cap_const('share') * 100), round(sh * 100);
    end if;
  end if;

  if exists(select 1 from public.war_offers
             where war_id = p_war and from_fid = me and kind = p_kind and status = 'pending') then
    raise exception 'такая нота уже отправлена — ждите ответа';
  end if;

  exp := now() + (public._war_cap_const('reply_h') || ' hours')::interval;
  insert into public.war_offers(war_id, from_fid, to_fid, kind, message, expires_at)
    values (p_war, me, case when p_kind='conference' then null else foe end, p_kind, msg, exp)
    returning id into oid;

  if p_kind = 'conference' then
    perform public._war_news(
      '🕊 Мирная конференция: ' || public._war_nm(me) || ' ↔ ' || public._war_nm(foe),
      public._news_pick(array[
        format('%s созывает мирную конференцию по войне с %s.%s Столы накрыты, стенографисты наточили перья — но пушки пока не остыли.',
               public._war_nm(me), public._war_nm(foe), case when msg is null then '' else ' Из ноты: «' || msg || '».' end),
        format('К переговорному столу: %s предлагает державе %s созвать конференцию.%s Сектор затаил дыхание.',
               public._war_nm(me), public._war_nm(foe), case when msg is null then '' else ' «' || msg || '» — гласит послание.' end),
        format('Объявлена мирная конференция по конфликту %s и %s.%s Посредники съезжаются, исход неясен.',
               public._war_nm(me), public._war_nm(foe), case when msg is null then '' else ' Инициатор заявляет: «' || msg || '».' end)
      ]),
      jsonb_build_array(me, foe));
  elsif p_kind = 'capitulation' then
    -- Ультиматум видят все: у адресата трое суток
    perform public._war_news(
      '⚑ Ультиматум: ' || public._war_nm(me) || ' → ' || public._war_nm(foe),
      format('%s держит %s%% систем державы %s и предлагает ей капитуляцию. На ответ — трое суток; молчание будет считаться согласием.%s',
             public._war_nm(me), round(sh * 100), public._war_nm(foe),
             case when msg is null then '' else ' Из ноты: «' || msg || '».' end),
      jsonb_build_array(me, foe));
  end if;
  return jsonb_build_object('ok', true, 'offer_id', oid, 'expires_at', exp);
end $$;

-- ── Ответ на ноту ────────────────────────────────────────────
create or replace function public.war_offer_respond__raw(p_offer uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text; o record; w record; newst text; winner text; loser text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into o from public.war_offers where id = p_offer for update;
  if o.id is null then raise exception 'no such offer'; end if;
  if o.status <> 'pending' then raise exception 'нота уже отвечена'; end if;
  select * into w from public.wars where id = o.war_id for update;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  if o.kind = 'call_ally' then raise exception 'зов союзника принимается через war_join'; end if;
  if o.to_fid is distinct from me or not public._war_is_leader(o.war_id, me) then
    raise exception 'эта нота адресована не вам';
  end if;

  if not coalesce(p_accept, false) then
    update public.war_offers set status='declined', resolved_at=now() where id = p_offer;
    perform public._war_news(
      '⚔ Мир отвергнут: ' || public._war_nm(me),
      public._news_pick(array[
        format('%s отвергает ноту державы %s. Война продолжается.', public._war_nm(me), public._war_nm(o.from_fid)),
        format('Переговоры сорваны: %s не принимает условий %s. Флоты возвращаются к делу.', public._war_nm(me), public._war_nm(o.from_fid)),
        format('%s отвечает отказом на предложение %s. Оружие остаётся горячим.', public._war_nm(me), public._war_nm(o.from_fid))
      ]),
      jsonb_build_array(me, o.from_fid));
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  if o.kind = 'conference' then
    raise exception 'конференция сама по себе не заканчивает войну — пришлите мирную ноту';
  end if;

  update public.war_offers set status='accepted', resolved_at=now() where id = p_offer;

  if o.kind = 'status_quo' then
    update public.wars set status = 'status_quo', ended_at = now(),
           outcome_note = coalesce(o.message, outcome_note) where id = w.id;
    update public.war_offers set status='expired', resolved_at=now()
     where war_id = w.id and status = 'pending';
    perform public._war_news(
      '🕊 Мир: ' || public._war_nm(w.attacker_fid) || ' ↔ ' || public._war_nm(w.defender_fid),
      public._news_pick(array[
        format('%s и %s подписывают белый мир. Ни пяди не перешло из рук в руки — только счета за топливо и списки погибших.',
               public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid)),
        format('Война между %s и %s окончена статус-кво. Границы там же, где были; вражда — тоже.',
               public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid)),
        format('Подписан мир на условиях статус-кво: %s и %s расходятся, оставшись при своём.',
               public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid))
      ]),
      (select coalesce(jsonb_agg(fid),'[]'::jsonb) from public.war_sides where war_id = w.id));
    return jsonb_build_object('ok', true, 'accepted', true, 'status', 'status_quo');
  end if;

  -- surrender — сдаётся отправитель; demand_surrender и capitulation — получатель
  loser  := case when o.kind = 'surrender' then o.from_fid else me end;
  winner := case when loser = w.attacker_fid then w.defender_fid else w.attacker_fid end;
  perform public._war_capitulate(w.id, winner, loser, o.message);
  newst := case when winner = w.attacker_fid then 'attacker_won' else 'defender_won' end;
  return jsonb_build_object('ok', true, 'accepted', true, 'status', newst);
end $$;

-- ── Просроченные ноты (планировщик) ──────────────────────────
create or replace function public.war_offers_expire() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; n_dec int := 0; n_cap int := 0; w public.wars;
begin
  for o in select * from public.war_offers
            where status = 'pending' and expires_at is not null and expires_at < now()
            order by created_at for update skip locked loop
    select * into w from public.wars where id = o.war_id;
    if w.id is null or w.status <> 'active' then
      update public.war_offers set status = 'expired', resolved_at = now() where id = o.id;
      continue;
    end if;
    if o.kind = 'capitulation' and o.to_fid is not null then
      -- молчание = согласие
      update public.war_offers set status = 'accepted', resolved_at = now() where id = o.id;
      begin
        perform public._war_capitulate(o.war_id, o.from_fid, o.to_fid,
          coalesce(o.message, 'капитуляция: ультиматум остался без ответа'));
        n_cap := n_cap + 1;
      exception when others then
        raise notice 'war_offers_expire % : %', o.id, sqlerrm;
      end;
    else
      update public.war_offers set status = 'declined', resolved_at = now() where id = o.id;
      n_dec := n_dec + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'declined', n_dec, 'capitulated', n_cap);
end $$;
revoke all on function public.war_offers_expire() from public, anon, authenticated;

-- ── Админ-команда: закрыть войну вручную ─────────────────────
create or replace function public.admin_war_end(p_war uuid, p_outcome text default 'status_quo', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.wars;
begin
  if coalesce(auth.uid()::text,'') <> '' and public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select * into w from public.wars where id = p_war for update;
  if w.id is null then raise exception 'no such war'; end if;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  if p_outcome not in ('status_quo','attacker_won','defender_won') then raise exception 'bad outcome'; end if;
  update public.wars set status = p_outcome, ended_at = now(),
         outcome_note = coalesce(p_note, 'закрыта администрацией') where id = p_war;
  update public.war_offers set status = 'expired', resolved_at = now()
   where war_id = p_war and status = 'pending';
  perform public._war_news(
    '🕊 Война закрыта: ' || public._war_nm(w.attacker_fid) || ' ↔ ' || public._war_nm(w.defender_fid),
    format('Война между %s и %s прекращена решением администрации сектора%s. Территории остаются у прежних владельцев.',
           public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid),
           case when p_outcome = 'status_quo' then ' на условиях статус-кво' else '' end),
    (select coalesce(jsonb_agg(fid),'[]'::jsonb) from public.war_sides where war_id = p_war));
  return jsonb_build_object('ok', true, 'war', p_war, 'status', p_outcome);
end $$;
revoke all on function public.admin_war_end(uuid, text, text) from public, anon;
grant execute on function public.admin_war_end(uuid, text, text) to authenticated;

-- ── Расписание ───────────────────────────────────────────────
do $$ begin
  perform cron.unschedule('war-offers-expire');
exception when others then null; end $$;
select cron.schedule('war-offers-expire', '9 * * * *', 'select public.war_offers_expire();');

-- ── war_status: доля систем противника и сроки нот для клиента ──
create or replace function public.war_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  return jsonb_build_object(
    'fid', me,
    'cap_min', public._war_cap_const('share'),
    'wars', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'status', w.status, 'cause', w.cause,
        'attacker', w.attacker_fid, 'attacker_name', public._war_nm(w.attacker_fid),
        'defender', w.defender_fid, 'defender_name', public._war_nm(w.defender_fid),
        'started_at', w.started_at,
        'my_side', public._war_side_of(w.id, me),
        'is_leader', public._war_is_leader(w.id, me),
        -- доля систем вражеского зачинщика под нашей оккупацией (порог ноты «капитуляция»)
        'cap_share', public._war_sys_share(me,
                       case when w.attacker_fid = me then w.defender_fid else w.attacker_fid end),
        'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                    'fid', s.fid, 'name', public._war_nm(s.fid), 'side', s.side) order by s.joined_at), '[]'::jsonb)
                  from public.war_sides s where s.war_id = w.id)
      ) order by w.started_at desc), '[]'::jsonb)
      from public.wars w
      where w.status = 'active'
        and exists(select 1 from public.war_sides s where s.war_id = w.id and s.fid = me)),
    'open_wars', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'cause', w.cause,
        'attacker', w.attacker_fid, 'attacker_name', public._war_nm(w.attacker_fid),
        'defender', w.defender_fid, 'defender_name', public._war_nm(w.defender_fid),
        'started_at', w.started_at) order by w.started_at desc), '[]'::jsonb)
      from public.wars w
      where w.status = 'active'
        and not exists(select 1 from public.war_sides s where s.war_id = w.id and s.fid = me)),
    'incoming', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'war_id', o.war_id, 'kind', o.kind, 'message', o.message,
        'from', o.from_fid, 'from_name', public._war_nm(o.from_fid),
        'created_at', o.created_at, 'expires_at', o.expires_at) order by o.created_at desc), '[]'::jsonb)
      from public.war_offers o where o.to_fid = me and o.status = 'pending'),
    'outgoing', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'war_id', o.war_id, 'kind', o.kind, 'message', o.message,
        'to', o.to_fid, 'to_name', case when o.to_fid is null then null else public._war_nm(o.to_fid) end,
        'created_at', o.created_at, 'expires_at', o.expires_at) order by o.created_at desc), '[]'::jsonb)
      from public.war_offers o where o.from_fid = me and o.status = 'pending'),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'status', w.status, 'cause', w.cause,
        'attacker_name', public._war_nm(w.attacker_fid),
        'defender_name', public._war_nm(w.defender_fid),
        'my_side', public._war_side_of(w.id, me),
        'started_at', w.started_at, 'ended_at', w.ended_at) order by w.ended_at desc), '[]'::jsonb)
      from (select * from public.wars
             where status <> 'active'
               and exists(select 1 from public.war_sides s where s.war_id = wars.id and s.fid = me)
             order by ended_at desc limit 20) w));
end $$;
