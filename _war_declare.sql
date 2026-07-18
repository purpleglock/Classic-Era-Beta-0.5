-- ============================================================
-- ВОЙНА, СРЕЗ 1: ДИПЛОМАТИЯ ВОЙНЫ
--
-- Вкладка «⚔ Война» в кабинете (economy.js, ecTabWar) — объявление
-- войны, созыв союзников, вступление в чужую войну, мирные ноты
-- (белый мир · капитуляция · требование капитуляции) и мирная
-- конференция. КАЖДОЕ действие уходит прозой в ленту событий
-- («◈ ХРОНИКА СЕКТОРА», _post_life_news из _news_mentions.sql).
--
-- Порядок применения в Supabase → SQL Editor:
--   этот файл можно катить НЕЗАВИСИМО от линии флотов — он не трогает
--   fleet_send/_fleet_settle. Требует лишь уже применённых
--   _economy_setup.sql, _news_mentions.sql, _events_prose.sql,
--   _diplo_unions.sql, _ban_enforcement.sql, _security_money.sql.
--
-- ВАЖНО для следующих срезов: единственная точка правды о том, кто с
-- кем воюет — функция public.at_war(a,b). Срез 2 (границы/оккупация)
-- и срез 3 (перехват) обязаны спрашивать ЕЁ, а не читать wars напрямую,
-- иначе союзники по войне потеряются.
--
-- Модель:
--   wars        — одна война = один конфликт с двумя коалициями.
--                 attacker_fid/defender_fid — зачинщики (только они
--                 подписывают мир за свою сторону).
--   war_sides   — участники коалиций (включая зачинщиков).
--   war_offers  — ноты: белый мир, капитуляция, требование капитуляции,
--                 созыв союзника, мирная конференция.
-- ============================================================

-- ── 1) Таблицы ───────────────────────────────────────────────
create table if not exists public.wars (
  id            uuid primary key default gen_random_uuid(),
  attacker_fid  text not null,
  defender_fid  text not null,
  cause         text,
  status        text not null default 'active',   -- active | status_quo | attacker_won | defender_won
  outcome_note  text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  constraint wars_sides_differ check (attacker_fid <> defender_fid),
  constraint wars_status_ck check (status in ('active','status_quo','attacker_won','defender_won'))
);
-- Одна активная война на пару держав (в любом порядке). Частичный
-- уникальный индекс по нормализованной паре: least/greatest.
create unique index if not exists wars_active_pair_uq
  on public.wars (least(attacker_fid, defender_fid), greatest(attacker_fid, defender_fid))
  where status = 'active';
create index if not exists wars_status_idx on public.wars (status);

create table if not exists public.war_sides (
  war_id    uuid not null references public.wars(id) on delete cascade,
  fid       text not null,
  side      text not null,                        -- attacker | defender
  joined_at timestamptz not null default now(),
  primary key (war_id, fid),
  constraint war_sides_side_ck check (side in ('attacker','defender'))
);
create index if not exists war_sides_fid_idx on public.war_sides (fid);

create table if not exists public.war_offers (
  id         uuid primary key default gen_random_uuid(),
  war_id     uuid not null references public.wars(id) on delete cascade,
  from_fid   text not null,
  to_fid     text,                                -- null = всей вражеской коалиции / всем союзникам
  kind       text not null,                       -- status_quo | surrender | demand_surrender | conference | call_ally
  message    text,
  status     text not null default 'pending',     -- pending | accepted | declined | expired
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_offers_kind_ck check (kind in ('status_quo','surrender','demand_surrender','conference','call_ally')),
  constraint war_offers_status_ck check (status in ('pending','accepted','declined','expired'))
);
create index if not exists war_offers_war_idx on public.war_offers (war_id, status);
create index if not exists war_offers_to_idx on public.war_offers (to_fid, status);

alter table public.wars       enable row level security;
alter table public.war_sides  enable row level security;
alter table public.war_offers enable row level security;

-- Войны публичны (о них пишет хроника), но пишет только сервер через RPC.
drop policy if exists wars_read on public.wars;
create policy wars_read on public.wars for select to authenticated using (true);
drop policy if exists war_sides_read on public.war_sides;
create policy war_sides_read on public.war_sides for select to authenticated using (true);
-- Ноты видит только адресат и отправитель: тайная дипломатия.
drop policy if exists war_offers_read on public.war_offers;
create policy war_offers_read on public.war_offers for select to authenticated
  using (from_fid = public._ec_my_fid() or to_fid is null or to_fid = public._ec_my_fid());

revoke insert, update, delete on public.wars, public.war_sides, public.war_offers from anon, authenticated;

-- ── 2) at_war(a,b) — ЕДИНСТВЕННАЯ точка правды ───────────────
-- true, если a и b состоят в одной активной войне по РАЗНЫЕ стороны.
-- Срезы 2-3 (границы, оккупация, перехват) спрашивают только её.
create or replace function public.at_war(p_a text, p_b text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
      from public.wars w
      join public.war_sides sa on sa.war_id = w.id and sa.fid = p_a
      join public.war_sides sb on sb.war_id = w.id and sb.fid = p_b
     where w.status = 'active' and sa.side <> sb.side);
$$;
grant execute on function public.at_war(text,text) to authenticated;

-- Все, с кем fid сейчас воюет (для карты и подсветки в кабинете).
create or replace function public.war_enemies_of(p_fid text)
returns setof text language sql stable security definer set search_path=public as $$
  select distinct sb.fid
    from public.wars w
    join public.war_sides sa on sa.war_id = w.id and sa.fid = p_fid
    join public.war_sides sb on sb.war_id = w.id and sb.side <> sa.side
   where w.status = 'active';
$$;
grant execute on function public.war_enemies_of(text) to authenticated;

-- ── 3) Внутренние помощники ──────────────────────────────────
create or replace function public._war_side_of(p_war uuid, p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select side from public.war_sides where war_id = p_war and fid = p_fid;
$$;

-- Зачинщик своей стороны? Только он подписывает мир и принимает капитуляцию.
create or replace function public._war_is_leader(p_war uuid, p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wars
                 where id = p_war and (attacker_fid = p_fid or defender_fid = p_fid));
$$;

create or replace function public._war_nm(p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(nullif(public._fac_name(p_fid), ''), 'Одна из держав');
$$;

-- Цвет войны в ленте — багровый, чтобы военные хроники читались отдельно.
create or replace function public._war_news(p_title text, p_body text, p_fids jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public._post_life_news(p_title, p_body, 'rgba(200,70,70,0.5)', coalesce(p_fids,'[]'::jsonb));
  exception when others then null;   -- хроника не должна валить военный акт
  end;
end$$;

-- ── 4) Объявление войны ──────────────────────────────────────
create or replace function public.war_declare(p_target_fid text, p_cause text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; w uuid; a text; d text; cz text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  if p_target_fid is null or p_target_fid = me then
    raise exception 'нельзя объявить войну самому себе';
  end if;
  if not exists(select 1 from public.faction_applications
                 where faction_id = p_target_fid and status = 'approved') then
    raise exception 'no such faction';
  end if;
  if public.at_war(me, p_target_fid) then
    raise exception 'война с этой державой уже идёт';
  end if;
  -- Союзникам по федерации/конфедерации воевать между собой нельзя:
  -- сначала выйти из союза.
  if exists(select 1 from public.diplo_members m1
              join public.diplo_members m2 on m2.union_id = m1.union_id
             where m1.fid = me and m2.fid = p_target_fid) then
    raise exception 'нельзя объявить войну союзнику по вашему же союзу — сначала выйдите из него';
  end if;

  cz := nullif(btrim(coalesce(p_cause, '')), '');
  insert into public.wars(attacker_fid, defender_fid, cause)
    values (me, p_target_fid, cz) returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, me, 'attacker'), (w, p_target_fid, 'defender');

  a := public._war_nm(me); d := public._war_nm(p_target_fid);
  perform public._war_news(
    '⚔ Объявлена война: ' || a || ' → ' || d,
    public._news_pick(array[
      format('%s объявляет войну державе %s.%s Ноты отозваны, посольства пустеют, границы больше не защищают никого.',
             a, d, case when cz is null then '' else ' Повод — «' || cz || '».' end),
      format('Война: %s поднимает знамёна против %s.%s Сектор замирает в ожидании первого залпа.',
             a, d, case when cz is null then '' else ' Заявленная причина — «' || cz || '».' end),
      format('%s разрывает мир с %s и объявляет войну.%s Дипломаты разъезжаются, слово переходит к флотам.',
             a, d, case when cz is null then '' else ' Casus belli: «' || cz || '».' end)
    ]),
    jsonb_build_array(me, p_target_fid));
  return jsonb_build_object('ok', true, 'war_id', w);
end$$;
revoke all on function public.war_declare(text,text) from public;
grant execute on function public.war_declare(text,text) to authenticated;

-- ── 5) Созыв союзника в войну ────────────────────────────────
create or replace function public.war_call_ally(p_war uuid, p_fid text, p_message text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; oid uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  sd := public._war_side_of(p_war, me);
  if sd is null then raise exception 'вы не участвуете в этой войне'; end if;
  if not exists(select 1 from public.wars where id = p_war and status = 'active') then
    raise exception 'война уже окончена';
  end if;
  if public._war_side_of(p_war, p_fid) is not null then
    raise exception 'эта держава уже в войне';
  end if;
  if exists(select 1 from public.war_offers
             where war_id = p_war and kind = 'call_ally' and to_fid = p_fid
               and from_fid = me and status = 'pending') then
    raise exception 'зов уже отправлен — ждите ответа';
  end if;
  insert into public.war_offers(war_id, from_fid, to_fid, kind, message)
    values (p_war, me, p_fid, 'call_ally', nullif(btrim(coalesce(p_message,'')),''))
    returning id into oid;
  -- Зов союзника — тайная нота, в общую хронику не идёт (иначе враг
  -- узнаёт о подкреплении раньше, чем оно пришло).
  return jsonb_build_object('ok', true, 'offer_id', oid);
end$$;
revoke all on function public.war_call_ally(uuid,text,text) from public;
grant execute on function public.war_call_ally(uuid,text,text) to authenticated;

-- ── 6) Вступление в войну ────────────────────────────────────
-- По зову (p_offer) либо по своей воле (p_offer = null + p_side).
create or replace function public.war_join(p_war uuid, p_side text default null, p_offer uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; nm text; foe text; w record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into w from public.wars where id = p_war;
  if w.id is null then raise exception 'no such war'; end if;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  if public._war_side_of(p_war, me) is not null then raise exception 'вы уже в этой войне'; end if;

  if p_offer is not null then
    select public._war_side_of(p_war, from_fid) into sd
      from public.war_offers
     where id = p_offer and war_id = p_war and to_fid = me
       and kind = 'call_ally' and status = 'pending';
    if sd is null then raise exception 'зов не найден или уже отвечен'; end if;
    update public.war_offers set status = 'accepted', resolved_at = now() where id = p_offer;
  else
    sd := p_side;
    if sd not in ('attacker','defender') then raise exception 'bad side'; end if;
  end if;

  insert into public.war_sides(war_id, fid, side) values (p_war, me, sd);

  nm  := public._war_nm(me);
  foe := public._war_nm(case when sd = 'attacker' then w.defender_fid else w.attacker_fid end);
  perform public._war_news(
    '⚔ В войну вступает ' || nm,
    public._news_pick(array[
      format('%s вступает в войну на стороне %s — против державы %s. Конфликт разрастается.',
             nm, public._war_nm(case when sd='attacker' then w.attacker_fid else w.defender_fid end), foe),
      format('Ещё одна держава берётся за оружие: %s объявляет себя врагом %s и присоединяется к войне.', nm, foe),
      format('%s более не наблюдает со стороны — её флоты идут против %s. Коалиция пополнилась.', nm, foe)
    ]),
    jsonb_build_array(me, w.attacker_fid, w.defender_fid));
  return jsonb_build_object('ok', true, 'side', sd);
end$$;
revoke all on function public.war_join(uuid,text,uuid) from public;
grant execute on function public.war_join(uuid,text,uuid) to authenticated;

-- ── 7) Мирные ноты ───────────────────────────────────────────
-- status_quo        — белый мир, все при своём (нужно согласие врага).
-- surrender         — я капитулирую (враг принимает → его победа).
-- demand_surrender  — требую капитуляции врага (примет → моя победа).
-- conference        — мирная конференция: РП-событие, публикуется СРАЗУ,
--                     войну не заканчивает, но открывает переговоры.
create or replace function public.war_offer_make(p_war uuid, p_kind text, p_message text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; foe text; oid uuid; msg text; w record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into w from public.wars where id = p_war;
  if w.id is null then raise exception 'no such war'; end if;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  sd := public._war_side_of(p_war, me);
  if sd is null then raise exception 'вы не участвуете в этой войне'; end if;
  if p_kind not in ('status_quo','surrender','demand_surrender','conference') then
    raise exception 'bad kind';
  end if;
  -- Мир подписывают только зачинщики: иначе младший союзник вывел бы
  -- из войны всю коалицию.
  if p_kind <> 'conference' and not public._war_is_leader(p_war, me) then
    raise exception 'мирные ноты подписывает только зачинщик стороны';
  end if;

  msg := nullif(btrim(coalesce(p_message,'')),'');
  foe := case when sd = 'attacker' then w.defender_fid else w.attacker_fid end;

  if exists(select 1 from public.war_offers
             where war_id = p_war and from_fid = me and kind = p_kind and status = 'pending') then
    raise exception 'такая нота уже отправлена — ждите ответа';
  end if;

  insert into public.war_offers(war_id, from_fid, to_fid, kind, message)
    values (p_war, me, case when p_kind='conference' then null else foe end, p_kind, msg)
    returning id into oid;

  if p_kind = 'conference' then
    -- Конференция — публичный жест, её видит весь сектор.
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
  end if;
  return jsonb_build_object('ok', true, 'offer_id', oid);
end$$;
revoke all on function public.war_offer_make(uuid,text,text) from public;
grant execute on function public.war_offer_make(uuid,text,text) to authenticated;

-- ── 8) Ответ на ноту → окончание войны ───────────────────────
create or replace function public.war_offer_respond(p_offer uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; o record; w record; newst text; winner text; loser text; ttl text; body text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into o from public.war_offers where id = p_offer for update;
  if o.id is null then raise exception 'no such offer'; end if;
  if o.status <> 'pending' then raise exception 'нота уже отвечена'; end if;
  select * into w from public.wars where id = o.war_id for update;
  if w.status <> 'active' then raise exception 'война уже окончена'; end if;
  if o.kind = 'call_ally' then raise exception 'зов союзника принимается через war_join'; end if;
  -- Отвечает зачинщик вражеской стороны.
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

  -- Принято → война окончена.
  if o.kind = 'status_quo' then
    newst := 'status_quo';
  elsif o.kind = 'surrender' then          -- капитулировал отправитель
    newst := case when public._war_side_of(o.war_id, o.from_fid) = 'attacker'
                  then 'defender_won' else 'attacker_won' end;
  elsif o.kind = 'demand_surrender' then   -- капитулирует принимающий
    newst := case when public._war_side_of(o.war_id, me) = 'attacker'
                  then 'defender_won' else 'attacker_won' end;
  else
    raise exception 'конференция сама по себе не заканчивает войну — пришлите мирную ноту';
  end if;

  update public.wars
     set status = newst, ended_at = now(),
         outcome_note = coalesce(o.message, outcome_note)
   where id = w.id;
  update public.war_offers set status='accepted', resolved_at=now() where id = p_offer;
  update public.war_offers set status='expired', resolved_at=now()
   where war_id = w.id and status = 'pending';

  if newst = 'status_quo' then
    ttl  := '🕊 Мир: ' || public._war_nm(w.attacker_fid) || ' ↔ ' || public._war_nm(w.defender_fid);
    body := public._news_pick(array[
      format('%s и %s подписывают белый мир. Ни пяди не перешло из рук в руки — только счета за топливо и списки погибших.',
             public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid)),
      format('Война между %s и %s окончена статус-кво. Границы там же, где были; вражда — тоже.',
             public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid)),
      format('Подписан мир на условиях статус-кво: %s и %s расходятся, оставшись при своём.',
             public._war_nm(w.attacker_fid), public._war_nm(w.defender_fid))
    ]);
  else
    winner := case when newst = 'attacker_won' then w.attacker_fid else w.defender_fid end;
    loser  := case when newst = 'attacker_won' then w.defender_fid else w.attacker_fid end;
    ttl    := '⚑ Капитуляция: ' || public._war_nm(loser) || ' → ' || public._war_nm(winner);
    body   := public._news_pick(array[
      format('%s капитулирует перед державой %s. Война окончена — победитель диктует, побеждённый подписывает.',
             public._war_nm(loser), public._war_nm(winner)),
      format('Знамёна %s спущены: держава признаёт поражение в войне с %s и складывает оружие.',
             public._war_nm(loser), public._war_nm(winner)),
      format('%s принимает капитуляцию %s. Сектор запоминает эту дату.',
             public._war_nm(winner), public._war_nm(loser))
    ]);
  end if;
  perform public._war_news(ttl, body,
    (select coalesce(jsonb_agg(fid),'[]'::jsonb) from public.war_sides where war_id = w.id));
  return jsonb_build_object('ok', true, 'accepted', true, 'status', newst);
end$$;
revoke all on function public.war_offer_respond(uuid,boolean) from public;
grant execute on function public.war_offer_respond(uuid,boolean) to authenticated;

-- ── 9) Отзыв своей ноты ──────────────────────────────────────
create or replace function public.war_offer_withdraw(p_offer uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  update public.war_offers set status='expired', resolved_at=now()
   where id = p_offer and from_fid = me and status = 'pending';
  if not found then raise exception 'нота не найдена или уже отвечена'; end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.war_offer_withdraw(uuid) from public;
grant execute on function public.war_offer_withdraw(uuid) to authenticated;

-- ── 10) Сводка для кабинета ──────────────────────────────────
-- Один вызов вместо пяти: активные войны (со сторонами), входящие и
-- исходящие ноты, история законченных войн (последние 20).
create or replace function public.war_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  return jsonb_build_object(
    'fid', me,
    'wars', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'status', w.status, 'cause', w.cause,
        'attacker', w.attacker_fid, 'attacker_name', public._war_nm(w.attacker_fid),
        'defender', w.defender_fid, 'defender_name', public._war_nm(w.defender_fid),
        'started_at', w.started_at,
        'my_side', public._war_side_of(w.id, me),
        'is_leader', public._war_is_leader(w.id, me),
        'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                    'fid', s.fid, 'name', public._war_nm(s.fid), 'side', s.side) order by s.joined_at), '[]'::jsonb)
                  from public.war_sides s where s.war_id = w.id)
      ) order by w.started_at desc), '[]'::jsonb)
      from public.wars w
      where w.status = 'active'
        and exists(select 1 from public.war_sides s where s.war_id = w.id and s.fid = me)),
    -- Чужие активные войны, куда можно вписаться по своей воле.
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
        'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
      from public.war_offers o where o.to_fid = me and o.status = 'pending'),
    'outgoing', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'war_id', o.war_id, 'kind', o.kind, 'message', o.message,
        'to', o.to_fid, 'to_name', case when o.to_fid is null then null else public._war_nm(o.to_fid) end,
        'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
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
end$$;
revoke all on function public.war_status() from public;
grant execute on function public.war_status() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- war_declare('<fid>','спорные рудники') → война + хроника в ленте.
-- war_status() → wars[0].my_side='attacker', is_leader=true.
-- war_offer_make(<war>,'conference','предлагаю встретиться') → сразу в ленту.
-- war_offer_make(<war>,'status_quo') → нота врагу; он: war_offer_respond(<id>,true)
--   → wars.status='status_quo', в ленте «🕊 Мир», все прочие ноты expired.
-- at_war('<a>','<b>') → false после мира. ЭТУ функцию спрашивают срезы 2-3.
