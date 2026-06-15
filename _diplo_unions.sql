-- ============================================================
-- ДИПЛОМАТИЯ · СОЮЗЫ — СЛАЙС 1: ФУНДАМЕНТ (федерация/конфедерация + вассалитет)
-- Применять в Supabase → SQL Editor. Идемпотентно. Эффекты (дань, защита, общий
-- флот) — слайсы 2-3. Здесь только данные + жизненный цикл + чтение.
--
-- Федерация/конфедерация = ГРУППА (лидер + участники, приглашения, выход).
-- Вассалитет = ПАРНЫЙ пакт (сюзерен + вассал, договорная дань%).
-- Запись только через SECURITY DEFINER RPC; чтение публичное (дипломатия открыта).
-- ВАЖНО: переменная фракции названа v_fid (НЕ fid) — иначе конфликт с колонкой fid.
-- ============================================================

create table if not exists public.diplo_unions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('federation','confederation')),
  name text not null,
  leader_fid text not null,
  created_at timestamptz default now()
);
create table if not exists public.diplo_members (
  union_id uuid references public.diplo_unions(id) on delete cascade,
  fid text not null,
  owner_id uuid,
  joined_at timestamptz default now(),
  primary key (union_id, fid)
);
create table if not exists public.diplo_invites (
  id uuid primary key default gen_random_uuid(),
  union_id uuid references public.diplo_unions(id) on delete cascade,
  fid text not null,
  owner_id uuid,
  status text default 'pending',
  created_at timestamptz default now()
);
create table if not exists public.diplo_vassals (
  id uuid primary key default gen_random_uuid(),
  overlord_fid text not null, vassal_fid text not null,
  overlord_owner uuid, vassal_owner uuid,
  tribute_pct numeric default 0.10,
  status text default 'pending',
  created_at timestamptz default now()
);
create index if not exists dm_fid_idx on public.diplo_members(fid);
create index if not exists dv_pair_idx on public.diplo_vassals(overlord_fid, vassal_fid, status);

alter table public.diplo_unions  enable row level security;
alter table public.diplo_members enable row level security;
alter table public.diplo_invites enable row level security;
alter table public.diplo_vassals enable row level security;
drop policy if exists "du_sel" on public.diplo_unions;
create policy "du_sel" on public.diplo_unions for select to authenticated using (true);
drop policy if exists "dmem_sel" on public.diplo_members;
create policy "dmem_sel" on public.diplo_members for select to authenticated using (true);
drop policy if exists "dinv_sel" on public.diplo_invites;
create policy "dinv_sel" on public.diplo_invites for select to authenticated using (true);
drop policy if exists "dv_sel" on public.diplo_vassals;
create policy "dv_sel" on public.diplo_vassals for select to authenticated using (true);

create or replace function public._fac_owner(p_fid text)
returns uuid language sql stable security definer set search_path=public as $$
  select owner_id from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1
$$;

-- ── СОЮЗ: создать ───────────────────────────────────────────
create or replace function public.union_create(p_kind text, p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; new_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if p_kind not in ('federation','confederation') then raise exception 'bad kind'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if exists(select 1 from public.diplo_members m where m.fid=v_fid) then raise exception 'already in a union'; end if;
  insert into public.diplo_unions(kind, name, leader_fid) values(p_kind, btrim(p_name), v_fid) returning id into new_id;
  insert into public.diplo_members(union_id, fid, owner_id) values(new_id, v_fid, v_uid);
  return jsonb_build_object('ok',true,'union_id',new_id);
end$$;
revoke all on function public.union_create(text,text) from public;
grant execute on function public.union_create(text,text) to authenticated;

-- ── СОЮЗ: пригласить фракцию (только лидер) ─────────────────
create or replace function public.union_invite(p_union_id uuid, p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  if not exists(select 1 from public.diplo_unions u where u.id=p_union_id and u.leader_fid=v_fid) then raise exception 'not the leader'; end if;
  if p_target_fid = v_fid then raise exception 'self'; end if;
  if exists(select 1 from public.diplo_members m where m.fid=p_target_fid) then raise exception 'target already in a union'; end if;
  if exists(select 1 from public.diplo_invites i where i.union_id=p_union_id and i.fid=p_target_fid and i.status='pending') then raise exception 'already invited'; end if;
  insert into public.diplo_invites(union_id, fid, owner_id, status)
    values(p_union_id, p_target_fid, public._fac_owner(p_target_fid), 'pending');
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.union_invite(uuid,text) from public;
grant execute on function public.union_invite(uuid,text) to authenticated;

-- ── СОЮЗ: ответить на приглашение ──────────────────────────
create or replace function public.union_invite_respond(p_invite_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; inv public.diplo_invites;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into inv from public.diplo_invites where id=p_invite_id and status='pending';
  if not found then raise exception 'invite not found'; end if;
  if inv.fid <> v_fid then raise exception 'not your invite'; end if;
  if not p_accept then update public.diplo_invites set status='declined' where id=p_invite_id; return jsonb_build_object('ok',true,'joined',false); end if;
  if exists(select 1 from public.diplo_members m where m.fid=v_fid) then raise exception 'already in a union'; end if;
  insert into public.diplo_members(union_id, fid, owner_id) values(inv.union_id, v_fid, auth.uid()) on conflict do nothing;
  update public.diplo_invites set status='accepted' where id=p_invite_id;
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.union_invite_respond(uuid,boolean) from public;
grant execute on function public.union_invite_respond(uuid,boolean) to authenticated;

-- ── СОЮЗ: выйти (лидер → передаёт лидерство; если один — распустить) ──
create or replace function public.union_leave()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; v_lead text; v_next text; v_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select m.union_id into v_uid from public.diplo_members m where m.fid=v_fid limit 1;
  if v_uid is null then raise exception 'not in a union'; end if;
  select leader_fid into v_lead from public.diplo_unions where id=v_uid;
  delete from public.diplo_members m where m.union_id=v_uid and m.fid=v_fid;
  select count(*) into v_cnt from public.diplo_members where union_id=v_uid;
  if v_cnt = 0 then
    delete from public.diplo_unions where id=v_uid;
  elsif v_lead = v_fid then
    select m.fid into v_next from public.diplo_members m where m.union_id=v_uid order by m.joined_at asc limit 1;
    update public.diplo_unions set leader_fid=v_next where id=v_uid;
  end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.union_leave() from public;
grant execute on function public.union_leave() to authenticated;

-- ── ВАССАЛИТЕТ: предложить (я → сюзерен, цель → вассал) ─────
create or replace function public.vassal_propose(p_target_fid text, p_tribute_pct numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; pct numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  if p_target_fid = v_fid then raise exception 'self'; end if;
  pct := greatest(0.05, least(0.30, coalesce(p_tribute_pct,0.10)));
  if exists(select 1 from public.diplo_vassals d where d.vassal_fid=p_target_fid and d.status in ('pending','active')) then
    raise exception 'target already a vassal or has a pending offer';
  end if;
  insert into public.diplo_vassals(overlord_fid, vassal_fid, overlord_owner, vassal_owner, tribute_pct, status)
    values(v_fid, p_target_fid, auth.uid(), public._fac_owner(p_target_fid), pct, 'pending');
  return jsonb_build_object('ok',true,'tribute_pct',pct);
end$$;
revoke all on function public.vassal_propose(text,numeric) from public;
grant execute on function public.vassal_propose(text,numeric) to authenticated;

-- ── ВАССАЛИТЕТ: ответить (вассал принимает/отклоняет) ──────
create or replace function public.vassal_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v public.diplo_vassals;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into v from public.diplo_vassals where id=p_id and status='pending';
  if not found then raise exception 'offer not found'; end if;
  if v.vassal_fid <> v_fid then raise exception 'not your offer'; end if;
  update public.diplo_vassals set status = case when p_accept then 'active' else 'declined' end where id=p_id;
  return jsonb_build_object('ok',true,'status', case when p_accept then 'active' else 'declined' end);
end$$;
revoke all on function public.vassal_respond(uuid,boolean) from public;
grant execute on function public.vassal_respond(uuid,boolean) to authenticated;

-- ── ВАССАЛИТЕТ: разорвать (любая сторона) ──────────────────
create or replace function public.vassal_break(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  update public.diplo_vassals set status='broken'
    where id=p_id and status in ('pending','active') and (overlord_fid=v_fid or vassal_fid=v_fid);
  if not found then raise exception 'not found or not a party'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.vassal_break(uuid) from public;
grant execute on function public.vassal_break(uuid) to authenticated;

-- ── Чтение: мой дипстатус (союз+участники, приглашения, вассалитеты) ──
create or replace function public.diplo_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; v_uid uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select m.union_id into v_uid from public.diplo_members m where m.fid=v_fid limit 1;
  return jsonb_build_object(
    'union', (select to_jsonb(u) from public.diplo_unions u where u.id=v_uid),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('fid',m.fid,'name',public._fac_name(m.fid)) order by m.joined_at), '[]'::jsonb)
                from public.diplo_members m where m.union_id=v_uid),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'union_id',i.union_id,
                  'kind',(select kind from public.diplo_unions where id=i.union_id),
                  'name',(select name from public.diplo_unions where id=i.union_id),
                  'leader',public._fac_name((select leader_fid from public.diplo_unions where id=i.union_id))) order by i.created_at desc), '[]'::jsonb)
                from public.diplo_invites i where i.fid=v_fid and i.status='pending'),
    'vassals', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'overlord',d.overlord_fid,'overlord_name',public._fac_name(d.overlord_fid),
                  'vassal',d.vassal_fid,'vassal_name',public._fac_name(d.vassal_fid),'tribute_pct',d.tribute_pct,'status',d.status) order by d.created_at desc), '[]'::jsonb)
                from public.diplo_vassals d where (d.overlord_fid=v_fid or d.vassal_fid=v_fid) and d.status in ('pending','active')));
end$$;
revoke all on function public.diplo_status() from public;
grant execute on function public.diplo_status() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- union_create('federation','Лига Эрленда') → союз+ты лидер. union_invite(uid,'<fid>')
-- → приглашение. vassal_propose('<fid>',0.15) → вассалитет на согласование.
