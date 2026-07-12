-- ============================================================================
--  БИРЖА · СРЕЗ 4c — РЕДАКТИРОВАНИЕ + МОДЕРАЦИЯ ОРГАНИЗАЦИЙ (через анкеты)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_demand.sql. Идемпотентно.
--  Зависит от: _exchange_corps.sql (corporations / corp_*), _exchange_demand.sql
--    (corps_status/corp_create со спросом — этот срез их НАДМНОЖЕСТВО),
--    _security_money.sql (_ec_my_fid), _economy_setup.sql (_fac_name,
--    current_user_role/current_user_banned).
--
--  ИДЕЯ (зеркало модерации ВЕР — _faith_moderation.sql). Игровые МЕХАНИКИ
--  (доход/дивиденды/спрос/торг долями) работают сразу — economy_* не трогаем.
--  На модерации держится только ПУБЛИЧНЫЙ КОНТЕНТ организации: название,
--  описание и эмблема. Пока стафф не одобрил — доли НЕ выходят на рынок
--  (corp_list_shares блокируется), поэтому немодерированное имя не утекает в мир.
--  Правки одобренной организации висят «в кармане» (corporations.pending) и
--  применяются к живым полям только после одобрения.
--
--  Жизненный цикл (зеркало faction_applications / faiths):
--    corp_create        → status='pending'                (новая, ждёт одобрения)
--    corp_review ✓      → status='approved'               (доли можно выставлять)
--    corp_review ✕      → status='rejected'               (учредитель правит/подаёт)
--    corp_edit (approved) → pending_review=true + pending={...}  (мир видит старое)
--    corp_review ✓ (edit) → pending → живые поля, pending_review=false
--    corp_review ✕ (edit) → pending очищается, контент прежний
--
--  ВАЖНО: пересоздаёт corps_status / corp_create как СТРОГИЕ надмножества версий
--  из _exchange_demand.sql (сохранены блок 'demand' и sector_mult; добавлено
--  только помеченное «-- МОД:»). Будущие слайсы, трогающие эти функции, должны
--  продублировать строки «-- МОД:».
-- ============================================================================

-- ── 1) СХЕМА: контент + поля модерации (существующие корпорации grandfathered) ─
alter table public.corporations add column if not exists description    text;
alter table public.corporations add column if not exists image_url      text;
alter table public.corporations add column if not exists status         text not null default 'approved';
alter table public.corporations add column if not exists pending_review boolean not null default false;
alter table public.corporations add column if not exists pending        jsonb;       -- застейдженная правка {name,description,image_url}
alter table public.corporations add column if not exists reject_reason  text;
alter table public.corporations add column if not exists reviewed_by    text;
alter table public.corporations add column if not exists reviewed_at    timestamptz;

do $$ begin
  alter table public.corporations add constraint corporations_status_chk
    check (status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;

-- ── 2) corp_create v2: + описание/эмблема, статус 'pending' ──────────────────
--    Механика (акции/дивиденды/спрос) живёт сразу; контент ждёт одобрения.
drop function if exists public.corp_create(text,jsonb);
create or replace function public.corp_create(
  p_name text, p_buildings jsonb, p_description text default null, p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; nm text; v_id uuid; bid uuid; cnt int; n_added int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_name is null or length(btrim(p_name)) < 2 then raise exception 'bad name'; end if;
  fid := public._ec_my_fid();
  if not public._corp_can_found(fid) then
    raise exception 'only corporate states may found organizations';
  end if;
  select count(*) into cnt from public.corporations where faction_id = fid;
  if cnt >= 10 then raise exception 'too many corporations'; end if;
  nm := coalesce(nullif(public._fac_name(fid),''),'Держава');

  insert into public.corporations(faction_id, founder_name, name, description, image_url, status)  -- МОД: контент + pending
    values (fid, nm, btrim(p_name),
            nullif(btrim(coalesce(p_description,'')),''),
            nullif(btrim(coalesce(p_image_url,'')),''),
            'pending')
    returning id into v_id;
  insert into public.corp_shares(corp_id, holder_fid, shares)
    values (v_id, fid, (select total_shares from public.corporations where id = v_id));

  if p_buildings is not null then
    for bid in select (jsonb_array_elements_text(p_buildings))::uuid loop
      perform 1 from public.colony_buildings where id = bid and faction_id = fid;
      if not found then continue; end if;
      perform 1 from public.corp_buildings where building_id = bid;
      if found then continue; end if;
      insert into public.corp_buildings(building_id, corp_id) values (bid, v_id);
      n_added := n_added + 1;
    end loop;
  end if;

  update public.corporations
     set share_price = round(public._corp_daily_net(v_id) * 20.0 / greatest(total_shares,1), 2)
   where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'buildings', n_added, 'status', 'pending');
end$$;
revoke all on function public.corp_create(text,jsonb,text,text) from public;
grant execute on function public.corp_create(text,jsonb,text,text) to authenticated;

-- ── 3) corp_edit: правка контента учредителем (через модерацию) ──────────────
create or replace function public.corp_edit(
  p_corp uuid, p_name text, p_description text default null, p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; co public.corporations; nm text; ds text; img text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into co from public.corporations where id = p_corp for update;
  if not found then raise exception 'no corporation'; end if;
  if co.faction_id <> fid then raise exception 'not your corporation'; end if;

  nm := btrim(coalesce(p_name,''));
  if length(nm) < 2 then raise exception 'bad name'; end if;
  ds  := nullif(btrim(coalesce(p_description,'')),'');
  img := nullif(btrim(coalesce(p_image_url,'')),'');

  if co.status = 'approved' then
    -- одобренная: прячем правку в карман, мир видит прежнее
    update public.corporations set
      pending = jsonb_build_object('name', nm, 'description', ds, 'image_url', img),
      pending_review = true, reject_reason = null
    where id = co.id;
    return jsonb_build_object('ok', true, 'staged', true);
  else
    -- ещё не одобрена (pending/rejected): правим живые поля и (пере)подаём
    update public.corporations set
      name = nm, description = ds, image_url = img,
      status = 'pending', pending_review = false, pending = null, reject_reason = null
    where id = co.id;
    return jsonb_build_object('ok', true, 'staged', false, 'status', 'pending');
  end if;
end$$;
revoke all on function public.corp_edit(uuid,text,text,text) from public;
grant execute on function public.corp_edit(uuid,text,text,text) to authenticated;

-- ── 4) corp_review: одобрение/отклонение стаффом ────────────────────────────
create or replace function public.corp_review(
  p_corp uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare co public.corporations; v_email text;
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  select * into co from public.corporations where id = p_corp;
  if not found then raise exception 'corporation not found'; end if;
  select email into v_email from auth.users where id = auth.uid();

  if p_approve then
    if co.pending_review and co.pending is not null then
      update public.corporations set
        name        = btrim(coalesce(co.pending->>'name', co.name)),
        description = nullif(btrim(coalesce(co.pending->>'description','')),''),
        image_url   = nullif(btrim(coalesce(co.pending->>'image_url','')),''),
        status = 'approved', pending = null, pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = co.id;
    else
      update public.corporations set
        status = 'approved', pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = co.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'approved');
  else
    if co.pending_review then
      update public.corporations set
        pending = null, pending_review = false, reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = co.id;
    else
      update public.corporations set
        status = 'rejected', reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = co.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
end$$;
revoke all on function public.corp_review(uuid,boolean,text) from public;
grant execute on function public.corp_review(uuid,boolean,text) to authenticated;

-- ── 5) corp_pending_list: очередь модерации (стафф) ─────────────────────────
create or replace function public.corp_pending_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_role() in ('superadmin','editor','moderator')
    then coalesce((select jsonb_agg(t.r order by t.kind, (t.r->>'created_at')) from (
      select (case when c.pending_review then 'edit' else 'new' end) as kind,
        jsonb_build_object(
          'id', c.id, 'status', c.status, 'is_edit', c.pending_review,
          'founder_fid', c.faction_id,
          'founder_name', coalesce(c.founder_name, public._fac_name(c.faction_id)),
          'created_at', c.created_at,
          'name', c.name, 'description', c.description, 'image_url', c.image_url,
          'proposed', c.pending,
          'buildings', (select count(*) from public.corp_buildings x where x.corp_id = c.id),
          'daily_gross', public._corp_daily_net(c.id)
        ) as r
      from public.corporations c
      where c.status = 'pending' or c.pending_review = true
    ) t), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke all on function public.corp_pending_list() from public;
grant execute on function public.corp_pending_list() to authenticated;

-- ── 6) corp_list_shares: доли выходят на рынок только у ОДОБРЕННОЙ организации ─
--    База: _exchange_corps.sql. Добавлено помеченное «-- МОД:».
create or replace function public.corp_list_shares(p_corp uuid, p_shares int, p_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; have int; v_id uuid; v_status text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_shares is null or p_shares < 1 then raise exception 'bad shares'; end if;
  if p_price is null or p_price < 1 then raise exception 'bad price'; end if;
  fid := public._ec_my_fid();
  select status into v_status from public.corporations where id = p_corp;      -- МОД:
  if v_status is distinct from 'approved' then                                 -- МОД: контент должен быть одобрен
    raise exception 'organization not approved: shares cannot be listed until moderation passes';
  end if;
  select shares into have from public.corp_shares where corp_id = p_corp and holder_fid = fid for update;
  if have is null or have < p_shares then raise exception 'not enough shares'; end if;
  update public.corp_shares set shares = shares - p_shares where corp_id = p_corp and holder_fid = fid;
  delete from public.corp_shares where corp_id = p_corp and holder_fid = fid and shares <= 0;
  insert into public.corp_listings(corp_id, seller_fid, shares, price)
    values (p_corp, fid, p_shares, floor(p_price)) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end$$;
revoke all on function public.corp_list_shares(uuid,int,numeric) from public;
grant execute on function public.corp_list_shares(uuid,int,numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  7) corps_status v3 — НАДМНОЖЕСТВО версии из _exchange_demand.sql.
--  Сохранены блок 'demand' и sector_mult (строки «-- СПРОС»). Добавлены поля
--  модерации/контента (строки «-- МОД:»). Чужой контент (описание/эмблема)
--  отдаётся только если организация одобрена; имя видно всегда (торг. идентичность).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corps_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'session', jsonb_build_object(
       'open', public.exchange_is_open(),
       'open_hour', (select open_hour from public.exchange_market where id=1),
       'close_hour',(select close_hour from public.exchange_market where id=1)),
    'can_found', public._corp_can_found(fid),
    'demand', jsonb_build_object(                                              -- СПРОС
       'mining',           public._demand_factor('mining'),
       'factory',          public._demand_factor('factory'),
       'shipyard',         public._demand_factor('shipyard'),
       'military_factory', public._demand_factor('military_factory'),
       'trade',            public._demand_factor('trade'),
       'temple',           public._demand_factor('temple')),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'base_gross', public._corp_daily_gross(c.id),
        'efficiency', public._corp_efficiency(c.id),
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'daily_gross', public._corp_daily_net(c.id),
        'description', c.description, 'image_url', c.image_url,                 -- МОД: контент (учредитель видит свой)
        'status', c.status, 'pending_review', c.pending_review,                -- МОД: статус модерации
        'pending', c.pending, 'reject_reason', c.reject_reason,                -- МОД: что предложено / причина отказа
        'my_shares', coalesce((select shares from public.corp_shares s where s.corp_id=c.id and s.holder_fid=fid),0),
        'holders', (select count(*) from public.corp_shares s where s.corp_id=c.id),
        'buildings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'colony', col.planet_name))
          from public.corp_buildings x join public.colony_buildings cb on cb.id=x.building_id
          left join public.colonies col on col.id=cb.colony_id where x.corp_id=c.id), '[]'::jsonb)
      ) order by c.created_at desc)
      from public.corporations c where c.faction_id = fid), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'corp_id', c.id, 'name', c.name, 'founder', coalesce(c.founder_name, public._fac_name(c.faction_id)),
        'shares', s.shares, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'value', round(s.shares * c.share_price),
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'description', case when c.status='approved' then c.description else null end,  -- МОД: чужой контент только одобренный
        'image_url',   case when c.status='approved' then c.image_url   else null end,  -- МОД:
        'daily_gross', public._corp_daily_net(c.id)))
      from public.corp_shares s join public.corporations c on c.id = s.corp_id
      where s.holder_fid = fid and c.faction_id <> fid), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'corp_id', c.id, 'name', c.name, 'seller', public._fac_name(l.seller_fid),
        'mine', (l.seller_fid = fid), 'shares', l.shares, 'price', l.price,
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'description', case when c.status='approved' then c.description else null end,  -- МОД:
        'image_url',   case when c.status='approved' then c.image_url   else null end,  -- МОД:
        'daily_gross', public._corp_daily_net(c.id), 'total_shares', c.total_shares)
      order by l.created_at desc)
      from public.corp_listings l join public.corporations c on c.id = l.corp_id), '[]'::jsonb),
    'free_buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'colony', col.planet_name,
        'daily_gc', case cb.btype
            when 'factory'          then cb.slots_open*200 when 'shipyard' then cb.slots_open*160
            when 'temple'           then cb.slots_open*150 when 'military_factory' then cb.slots_open*140
            when 'mining'           then cb.slots_open*120 when 'trade' then cb.slots_open*100
            when 'mining_deep'      then cb.slots_open*200 when 'mining_exotic' then cb.slots_open*450
            else 0 end))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;
revoke all on function public.corps_status() from public;
grant execute on function public.corps_status() to authenticated;

-- PostgREST: подхватить новые/изменённые сигнатуры
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select corp_create('Орбитальный консорциум', '[]'::jsonb, 'Добываем будущее', null);  -- status=pending
-- 2) select corp_pending_list();                       -- под стаффом: новая в очереди
-- 3) select corp_list_shares('<corp_id>', 100, 50);    -- ОШИБКА «not approved» пока не одобрено
-- 4) select corp_review('<corp_id>'::uuid, true, null);-- одобрить → доли можно выставлять
-- 5) select corp_edit('<corp_id>'::uuid, 'Новое имя', 'новое описание', null);  -- staged=true (approved)
-- 6) select corp_review('<corp_id>'::uuid, true, null);-- применить правку
