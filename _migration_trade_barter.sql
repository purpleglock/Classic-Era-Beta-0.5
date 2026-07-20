-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: обмен/бартер (Торговля)
--  Передача с возможностью запросить что-то взамен. Активы: ГС, ОН, ресурсы
--  склада, корабли (передача владения). Схема «предложение → принятие»:
--    • want пустой  → мгновенный подарок (как старый «Передать»);
--    • want задан    → отложенное предложение, партнёр принимает → атомарный обмен.
--
--  Формат give/want (jsonb):
--    { "gc": 1000, "science": 50,
--      "resources": {"Железо": 100}, "ships": {"Фрегат «Заря»": 2} }
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Самодостаточно.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Таблица предложений обмена
create table if not exists public.barter_offers (
  id          uuid primary key default gen_random_uuid(),
  from_fid    text not null,
  to_fid      text not null,
  from_owner  uuid,
  give        jsonb not null default '{}'::jsonb,
  want        jsonb not null default '{}'::jsonb,
  status      text not null default 'pending',   -- pending | accepted | rejected | cancelled
  created_at  timestamptz default now(),
  resolved_at timestamptz
);
create index if not exists bo_from_idx on public.barter_offers(from_fid);
create index if not exists bo_to_idx   on public.barter_offers(to_fid);

alter table public.barter_offers enable row level security;
drop policy if exists "bo_sel" on public.barter_offers;
-- видеть предложение могут обе стороны (владелец from- или to-фракции)
create policy "bo_sel" on public.barter_offers for select using (
  exists (
    select 1 from public.faction_applications fa
    where fa.owner_id = auth.uid() and fa.status = 'approved'
      and fa.faction_id in (public.barter_offers.from_fid, public.barter_offers.to_fid)
  )
);
-- запись/изменение — только через RPC (security definer)

-- 2. Есть ли в наборе хоть один положительный актив
create or replace function public._barter_has_any(p jsonb)
returns boolean language sql immutable as $$
  select coalesce((p->>'gc')::numeric,0) > 0
      or coalesce((p->>'science')::numeric,0) > 0
      or (p ? 'resources' and exists(select 1 from jsonb_each_text(p->'resources') where value::numeric > 0))
      or (p ? 'ships'     and exists(select 1 from jsonb_each_text(p->'ships')     where value::numeric > 0));
$$;

-- 3. Проверка наличия активов у фракции (без изменений) — для валидации предложения
create or replace function public._barter_check(p_fid text, p_assets jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare cur numeric; k text; v numeric; nm text; q int; have int;
begin
  if p_assets is null then return; end if;
  if coalesce((p_assets->>'gc')::numeric,0) > 0 then
    select gc into cur from public.faction_economy where faction_id=p_fid;
    if coalesce(cur,0) < (p_assets->>'gc')::numeric then raise exception 'not enough GC'; end if;
  end if;
  if coalesce((p_assets->>'science')::numeric,0) > 0 then
    select science into cur from public.faction_economy where faction_id=p_fid;
    if coalesce(cur,0) < (p_assets->>'science')::numeric then raise exception 'not enough science'; end if;
  end if;
  if p_assets ? 'resources' then
    for k, v in select key, value::numeric from jsonb_each_text(p_assets->'resources') loop
      if v <= 0 then continue; end if;
      select coalesce((resources->>k)::numeric,0) into cur from public.faction_economy where faction_id=p_fid;
      if coalesce(cur,0) < v then raise exception 'not enough resource: %', k; end if;
    end loop;
  end if;
  if p_assets ? 'ships' then
    for nm, q in select key, value::int from jsonb_each_text(p_assets->'ships') loop
      if q <= 0 then continue; end if;
      select coalesce(sum(qty),0) into have from public.unit_production
        where faction_id=p_fid and category='ship' and status='done' and unit_name=nm;
      if have < q then raise exception 'not enough ships: %', nm; end if;
    end loop;
  end if;
end$$;

-- 4. Перенос активов p_from → p_to (с проверкой; raise при нехватке)
create or replace function public._barter_move(p_from text, p_to text, p_assets jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare amt numeric; k text; v numeric; cur numeric; to_owner uuid; nm text; q int; have int; remain int; r record;
begin
  if p_assets is null then return; end if;
  -- ГС
  amt := coalesce((p_assets->>'gc')::numeric, 0);
  if amt > 0 then
    select gc into cur from public.faction_economy where faction_id=p_from;
    if coalesce(cur,0) < amt then raise exception 'not enough GC'; end if;
    update public.faction_economy set gc=gc-amt where faction_id=p_from;
    update public.faction_economy set gc=gc+amt where faction_id=p_to;
  end if;
  -- ОН
  amt := coalesce((p_assets->>'science')::numeric, 0);
  if amt > 0 then
    select science into cur from public.faction_economy where faction_id=p_from;
    if coalesce(cur,0) < amt then raise exception 'not enough science'; end if;
    update public.faction_economy set science=science-amt where faction_id=p_from;
    update public.faction_economy set science=science+amt where faction_id=p_to;
  end if;
  -- ресурсы склада
  if p_assets ? 'resources' then
    for k, v in select key, value::numeric from jsonb_each_text(p_assets->'resources') loop
      if v <= 0 then continue; end if;
      select coalesce((resources->>k)::numeric,0) into cur from public.faction_economy where faction_id=p_from;
      if cur < v then raise exception 'not enough resource: %', k; end if;
      update public.faction_economy
        set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[k], to_jsonb(cur - v)) where faction_id=p_from;
      update public.faction_economy
        set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[k], to_jsonb(coalesce((resources->>k)::numeric,0) + v)) where faction_id=p_to;
    end loop;
  end if;
  -- корабли (по имени модели) — передача владения
  -- ВАЖНО: сохраняем unit_id (id чертежа), иначе переданный корабль не проходит
  -- фильтры формирования флота (unit_id=…) и назначения в караван (join faction_units).
  if p_assets ? 'ships' then
    select owner_id into to_owner from public.faction_applications
      where faction_id=p_to and status='approved' order by updated_at desc limit 1;
    for nm, q in select key, value::int from jsonb_each_text(p_assets->'ships') loop
      if q <= 0 then continue; end if;
      select coalesce(sum(qty),0) into have from public.unit_production
        where faction_id=p_from and category='ship' and status='done' and unit_name=nm;
      if have < q then raise exception 'not enough ships: %', nm; end if;
      remain := q;
      for r in select id, qty, unit_id from public.unit_production
        where faction_id=p_from and category='ship' and status='done' and unit_name=nm order by created_at asc loop
        exit when remain <= 0;
        if r.qty <= remain then
          delete from public.unit_production where id=r.id;
          insert into public.unit_production (faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at, created_at)
            values (p_to, to_owner, r.unit_id, nm, 'ship', 'shipyard', r.qty, 'done', now(), now());
          remain := remain - r.qty;
        else
          update public.unit_production set qty=qty-remain where id=r.id;
          insert into public.unit_production (faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at, created_at)
            values (p_to, to_owner, r.unit_id, nm, 'ship', 'shipyard', remain, 'done', now(), now());
          remain := 0;
        end if;
      end loop;
    end loop;
  end if;
end$$;

-- 5. Предложить обмен (или подарок, если want пуст)
create or replace function public.barter_propose(p_to_fid text, p_give jsonb, p_want jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'cannot trade with self'; end if;
  perform 1 from public.faction_economy where faction_id=p_to_fid;
  if not found then raise exception 'recipient has no economy'; end if;
  p_give := coalesce(p_give,'{}'::jsonb);
  p_want := coalesce(p_want,'{}'::jsonb);
  if not public._barter_has_any(p_give) then raise exception 'nothing to give'; end if;
  perform public._barter_check(app.faction_id, p_give);     -- у нас должно быть то, что отдаём
  if not public._barter_has_any(p_want) then
    -- подарок: переносим сразу
    perform public._barter_move(app.faction_id, p_to_fid, p_give);
    return jsonb_build_object('ok', true, 'gift', true);
  end if;
  insert into public.barter_offers (from_fid, to_fid, from_owner, give, want)
    values (app.faction_id, p_to_fid, auth.uid(), p_give, p_want);
  return jsonb_build_object('ok', true);
end$$;

-- 6. Принять обмен — атомарно
create or replace function public.barter_accept(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.barter_offers; app public.faction_applications;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into o from public.barter_offers where id=p_id and status='pending' for update;
  if not found then raise exception 'offer not found'; end if;
  if o.to_fid != app.faction_id then raise exception 'not your offer'; end if;
  perform public._barter_move(o.from_fid, o.to_fid, o.give);   -- предлагающий отдаёт нам
  perform public._barter_move(o.to_fid, o.from_fid, o.want);   -- мы отдаём встречное
  update public.barter_offers set status='accepted', resolved_at=now() where id=p_id;
  return jsonb_build_object('ok', true);
end$$;

-- 7. Отклонить (получатель) / отозвать (отправитель)
create or replace function public.barter_reject(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  update public.barter_offers set status='rejected', resolved_at=now()
    where id=p_id and status='pending' and to_fid=app.faction_id;
  if not found then raise exception 'offer not found'; end if;
  return jsonb_build_object('ok', true);
end$$;

create or replace function public.barter_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  update public.barter_offers set status='cancelled', resolved_at=now()
    where id=p_id and status='pending' and from_fid=app.faction_id;
  if not found then raise exception 'offer not found'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- 8. Гранты
revoke all on function public._barter_has_any(jsonb) from public;
revoke all on function public._barter_check(text,jsonb) from public;
revoke all on function public._barter_move(text,text,jsonb) from public;
revoke all on function public.barter_propose(text,jsonb,jsonb) from public;
revoke all on function public.barter_accept(uuid) from public;
revoke all on function public.barter_reject(uuid) from public;
revoke all on function public.barter_cancel(uuid) from public;
grant execute on function public.barter_propose(text,jsonb,jsonb) to authenticated;
grant execute on function public.barter_accept(uuid) to authenticated;
grant execute on function public.barter_reject(uuid) to authenticated;
grant execute on function public.barter_cancel(uuid) to authenticated;
