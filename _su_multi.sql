-- ============================================================
-- УНИЯ ГОСУДАРСТВ — многочленная (было: строго два игрока)
-- Применять ПОСЛЕ _state_union.sql. Идемпотентно.
--
-- Что меняется:
--  1) Уния = ведущий fid + ЛЮБОЕ число партнёров (по строке на партнёра,
--     все строки делят один lead_fid). _su_lead_of/_ec_my_fid уже это тянут.
--  2) Член унии может звать в неё новые державы (приглашение).
--  3) Держава со стороны может САМА проситься в существующую унию (заявка) —
--     отвечает любой действующий член унии.
--  4) Расторжение: партнёр выходит сам; ведущий распускает унию целиком.
-- ============================================================

alter table public.state_unions add column if not exists initiator_fid text;
update public.state_unions set initiator_fid = lead_fid where initiator_fid is null;

-- ── Состав унии (ведущий + активные партнёры) ───────────────
create or replace function public._su_members(p_lead text)
returns table(fid text) language sql stable security definer set search_path=public as $$
  select p_lead
  union
  select partner_fid from public.state_unions where status='active' and lead_fid=p_lead
$$;

create or replace function public._su_is_member(p_lead text, p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public._su_members(p_lead) m where m.fid = p_fid)
$$;

-- ── RPC: предложить унию / позваться в унию ─────────────────
create or replace function public.su_propose(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_lead text; v_tlead text; v_row_lead text; v_row_partner text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;
  if p_target_fid is null or p_target_fid = v_fid then raise exception 'bad target'; end if;
  if not exists(select 1 from public.faction_applications where faction_id=p_target_fid and status='approved') then
    raise exception 'target faction not found'; end if;

  v_lead  := public._su_lead_of(v_fid);
  v_tlead := public._su_lead_of(p_target_fid);

  if v_lead is not null and v_tlead is not null then
    if v_lead = v_tlead then raise exception 'already in the same union'; end if;
    raise exception 'both states are already in unions';
  end if;

  if v_lead is not null then
    -- я в унии → зову державу к нам
    v_row_lead := v_lead; v_row_partner := p_target_fid;
  elsif v_tlead is not null then
    -- цель в унии, я нет → заявка на вступление, ведущий = их ведущий
    v_row_lead := v_tlead; v_row_partner := v_fid;
  else
    -- обе сами по себе → классическая уния, ведущий = инициатор
    v_row_lead := v_fid; v_row_partner := p_target_fid;
  end if;

  if exists(select 1 from public.state_unions
      where status='pending' and lead_fid=v_row_lead and partner_fid=v_row_partner) then
    raise exception 'proposal already pending'; end if;
  -- встречное предложение той же пары (мы им / они нам) — тоже дубль
  if exists(select 1 from public.state_unions
      where status='pending' and lead_fid=p_target_fid and partner_fid=v_fid) then
    raise exception 'proposal already pending'; end if;

  insert into public.state_unions(lead_fid, partner_fid, initiator_fid)
    values (v_row_lead, v_row_partner, v_fid);
  return jsonb_build_object('ok',true,'lead_fid',v_row_lead,'partner_fid',v_row_partner);
end$$;
revoke all on function public.su_propose(text) from public;
grant execute on function public.su_propose(text) to authenticated;

-- ── RPC: ответить на предложение ────────────────────────────
-- Отвечает ПРОТИВОПОЛОЖНАЯ сторона: на приглашение — приглашённая держава,
-- на заявку о вступлении — любой действующий член унии.
create or replace function public.su_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; u public.state_unions; v_lead_name text; v_partner_name text; v_lead_color text; v_may boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  select * into u from public.state_unions where id=p_id and status='pending';
  if not found then raise exception 'proposal not found'; end if;

  if u.initiator_fid = u.partner_fid then
    -- заявка на вступление: решает уния
    v_may := public._su_is_member(u.lead_fid, v_fid);
  else
    v_may := (u.partner_fid = v_fid);
  end if;
  if not v_may then raise exception 'not your proposal'; end if;

  if not p_accept then
    update public.state_unions set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'joined',false);
  end if;

  -- присоединяемая держава не должна быть в другой унии,
  -- ведущий должен оставаться ведущим (или быть сам по себе)
  if public._su_lead_of(u.partner_fid) is not null then
    raise exception 'state is already in a union'; end if;
  if coalesce(public._su_lead_of(u.lead_fid), u.lead_fid) <> u.lead_fid then
    raise exception 'lead state is already in another union'; end if;

  update public.state_unions set status='active', sealed_at=now() where id=p_id;
  perform public._su_merge_assets(u.lead_fid, u.partner_fid);

  select name, color into v_lead_name, v_lead_color from public.faction_applications where faction_id=u.lead_fid and status='approved' limit 1;
  select name into v_partner_name from public.faction_applications where faction_id=u.partner_fid and status='approved' limit 1;
  perform public._su_news(
    format('Уния «%s» приняла «%s»', coalesce(v_lead_name,u.lead_fid), coalesce(v_partner_name,u.partner_fid)),
    format('«%s» вступает в государственное объединение под началом «%s»: колонии, казна и вооружённые силы отныне общие. Флаг каждой державы сохранён.',
      coalesce(v_partner_name,u.partner_fid), coalesce(v_lead_name,u.lead_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.su_respond(uuid,boolean) from public;
grant execute on function public.su_respond(uuid,boolean) to authenticated;

-- ── RPC: отозвать своё предложение (по инициатору) ──────────
create or replace function public.su_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  v_fid := public._su_raw_fid();
  update public.state_unions set status='declined'
    where id=p_id and status='pending'
      and (initiator_fid = v_fid or (initiator_fid is null and lead_fid = v_fid));
  if not found then raise exception 'proposal not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.su_withdraw(uuid) from public;
grant execute on function public.su_withdraw(uuid) to authenticated;

-- ── RPC: выход/роспуск ──────────────────────────────────────
-- p_fid null: партнёр выходит сам; ведущий — распускает унию целиком.
-- p_fid задан и вызывает ведущий: исключить конкретного партнёра.
create or replace function public.su_dissolve(p_fid text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_lead text; v_n int; v_lead_name text; v_lead_color text; v_who text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  v_lead := public._su_lead_of(v_fid);
  if v_lead is null then raise exception 'no active union'; end if;

  select name, color into v_lead_name, v_lead_color from public.faction_applications where faction_id=v_lead and status='approved' limit 1;

  if v_lead = v_fid then
    -- ведущий
    if p_fid is null then
      update public.state_unions set status='dissolved' where status='active' and lead_fid=v_lead;
      get diagnostics v_n = row_count;
      begin update public.map_systems set union_origin=null where faction=v_lead; exception when others then null; end;
      perform public._su_news(
        format('Уния «%s» распущена', coalesce(v_lead_name,v_lead)),
        format('Государственное объединение под началом «%s» прекращает существование (%s держав). Общие активы остаются за ведущей державой.', coalesce(v_lead_name,v_lead), v_n),
        v_lead_color);
      return jsonb_build_object('ok',true,'left',v_n);
    end if;
    update public.state_unions set status='dissolved'
      where status='active' and lead_fid=v_lead and partner_fid=p_fid;
    if not found then raise exception 'member not found'; end if;
    v_who := p_fid;
  else
    -- партнёр выходит сам
    update public.state_unions set status='dissolved'
      where status='active' and lead_fid=v_lead and partner_fid=v_fid;
    if not found then raise exception 'no active union'; end if;
    v_who := v_fid;
  end if;

  select name into v_lead_name from public.faction_applications where faction_id=v_lead and status='approved' limit 1;
  perform public._su_news(
    format('Уния «%s»: выход державы', coalesce(v_lead_name,v_lead)),
    format('«%s» покидает государственное объединение под началом «%s». Общие активы остаются за ведущей державой.',
      coalesce((select name from public.faction_applications where faction_id=v_who and status='approved' limit 1), v_who),
      coalesce(v_lead_name,v_lead)),
    v_lead_color);
  return jsonb_build_object('ok',true,'left',1);
end$$;
revoke all on function public.su_dissolve(text) from public;
grant execute on function public.su_dissolve(text) to authenticated;
-- старая безаргументная версия больше не нужна
drop function if exists public.su_dissolve();
