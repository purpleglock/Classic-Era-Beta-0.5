-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: продажа технологий и чертежей (адресное предложение, как караван)
--
--  Продавец предлагает КОНКРЕТНОЙ фракции:
--    • технологию (tech-ключ из своего research) — копируется покупателю;
--    • чертёж (юнит из faction_units) — покупатель получает КОПИЮ в свою фракцию,
--      но ТОЛЬКО если у него уже изучены все тех-ключи чертежа (req_tech).
--  Продавец получает ГС, покупатель платит ГС.
--
--  req_tech для чертежа считает клиент (cnUnitReqTech) и кладёт в лот при создании —
--  сервер лишь сверяет с research покупателя.
--
--  Применять в Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.tech_offers (
  id            uuid primary key default gen_random_uuid(),
  seller_fid    text not null,
  seller_owner  uuid not null,
  seller_name   text,
  buyer_fid     text not null,
  buyer_owner   uuid,
  kind          text not null check (kind in ('tech','blueprint')),
  -- технология
  tech_key      text,
  tech_label    text,
  -- чертёж
  unit_name     text,
  unit_category text,
  unit_snapshot jsonb,
  req_tech      jsonb not null default '[]'::jsonb,
  price         numeric not null default 0 check (price >= 0),
  status        text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at    timestamptz not null default now()
);
create index if not exists tech_offers_buyer_idx  on public.tech_offers(buyer_fid, status);
create index if not exists tech_offers_seller_idx on public.tech_offers(seller_fid, status);

alter table public.tech_offers enable row level security;
drop policy if exists tech_offers_sel on public.tech_offers;
create policy tech_offers_sel on public.tech_offers for select to authenticated
  using (seller_owner = auth.uid() or buyer_owner = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));
-- запись/изменение — только через RPC (security definer), прямого insert/update игроку не даём

-- ── Предложить (продавец) ──────────────────────────────────────────────
create or replace function public.tech_offer_propose(
  p_buyer_fid text, p_kind text,
  p_tech_key text, p_tech_label text,
  p_unit_name text, p_unit_category text, p_unit_snapshot jsonb, p_req_tech jsonb,
  p_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; b_owner uuid; sresearch jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_price is null or p_price < 0 then raise exception 'bad price'; end if;
  if p_kind not in ('tech','blueprint') then raise exception 'bad kind'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_buyer_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into b_owner from public.faction_applications where faction_id=p_buyer_fid and status='approved' order by updated_at desc limit 1;
  if b_owner is null then raise exception 'recipient not found'; end if;

  if p_kind = 'tech' then
    if coalesce(p_tech_key,'') = '' then raise exception 'no tech'; end if;
    select research into sresearch from public.faction_economy where faction_id=app.faction_id;
    if not (coalesce(sresearch,'[]'::jsonb) ? p_tech_key) then raise exception 'seller lacks tech'; end if;
  else
    if p_unit_snapshot is null then raise exception 'no blueprint'; end if;
  end if;

  insert into public.tech_offers(seller_fid, seller_owner, seller_name, buyer_fid, buyer_owner,
    kind, tech_key, tech_label, unit_name, unit_category, unit_snapshot, req_tech, price, status)
  values(app.faction_id, auth.uid(), app.name, p_buyer_fid, b_owner,
    p_kind, p_tech_key, p_tech_label, p_unit_name, p_unit_category, p_unit_snapshot,
    coalesce(p_req_tech,'[]'::jsonb), p_price, 'pending');
  return jsonb_build_object('ok', true);
end$$;

-- ── Принять (покупатель) ───────────────────────────────────────────────
create or replace function public.tech_offer_accept(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare off public.tech_offers; bapp public.faction_applications; bal numeric; bresearch jsonb; missing text; tk text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into off from public.tech_offers where id=p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  if off.status <> 'pending' then raise exception 'offer not pending'; end if;
  if off.buyer_owner <> auth.uid() then raise exception 'forbidden'; end if;

  -- баланс покупателя
  select gc, research into bal, bresearch from public.faction_economy where faction_id=off.buyer_fid for update;
  if bal is null then raise exception 'no economy'; end if;
  if bal < off.price then raise exception 'not enough gc'; end if;

  -- чертёж: покупатель должен иметь ВСЕ нужные технологии
  if off.kind = 'blueprint' then
    for tk in select jsonb_array_elements_text(coalesce(off.req_tech,'[]'::jsonb)) loop
      if not (coalesce(bresearch,'[]'::jsonb) ? tk) then missing := tk; exit; end if;
    end loop;
    if missing is not null then raise exception 'missing prerequisites: %', missing; end if;
  end if;

  -- деньги: покупатель платит, продавец получает
  update public.faction_economy set gc = gc - off.price where faction_id=off.buyer_fid;
  update public.faction_economy set gc = gc + off.price where faction_id=off.seller_fid;

  if off.kind = 'tech' then
    -- добавить тех-ключ покупателю (если ещё нет)
    if not (coalesce(bresearch,'[]'::jsonb) ? off.tech_key) then
      update public.faction_economy
        set research = coalesce(research,'[]'::jsonb) || to_jsonb(off.tech_key)
        where faction_id=off.buyer_fid;
    end if;
  else
    -- клонировать чертёж в фракцию покупателя
    select * into bapp from public.faction_applications where faction_id=off.buyer_fid and status='approved' order by updated_at desc limit 1;
    insert into public.faction_units(category, name, summary, data, card_text,
      faction_id, faction_name, faction_color, owner_id, owner_email, updated_at)
    values(off.unit_category,
      coalesce(off.unit_snapshot->>'name', off.unit_name, 'Чертёж'),
      off.unit_snapshot->'summary',
      off.unit_snapshot->'data',
      off.unit_snapshot->>'card_text',
      off.buyer_fid, bapp.name, bapp.color, off.buyer_owner, null, now());
  end if;

  update public.tech_offers set status='accepted' where id=p_offer_id;
  return jsonb_build_object('ok', true, 'gc', bal - off.price);
end$$;

-- ── Отклонить (покупатель) ─────────────────────────────────────────────
create or replace function public.tech_offer_reject(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare off public.tech_offers;
begin
  select * into off from public.tech_offers where id=p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  if off.buyer_owner <> auth.uid() then raise exception 'forbidden'; end if;
  if off.status <> 'pending' then raise exception 'offer not pending'; end if;
  update public.tech_offers set status='rejected' where id=p_offer_id;
  return jsonb_build_object('ok', true);
end$$;

-- ── Отменить (продавец) ────────────────────────────────────────────────
create or replace function public.tech_offer_cancel(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare off public.tech_offers;
begin
  select * into off from public.tech_offers where id=p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  if off.seller_owner <> auth.uid() then raise exception 'forbidden'; end if;
  if off.status <> 'pending' then raise exception 'offer not pending'; end if;
  update public.tech_offers set status='cancelled' where id=p_offer_id;
  return jsonb_build_object('ok', true);
end$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'tech_offer_propose(text,text,text,text,text,text,jsonb,jsonb,numeric)',
    'tech_offer_accept(uuid)','tech_offer_reject(uuid)','tech_offer_cancel(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end$$;
