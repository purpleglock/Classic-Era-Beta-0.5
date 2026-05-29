-- ============================================================
-- РЕГИСТРАЦИЯ ГОСУДАРСТВ — таблица анкет, RLS, RPC одобрения
-- Выполнить целиком в Supabase → SQL Editor
-- Требует: функция public.current_user_role() (создана ранее),
--          таблицы public.map_systems / public.map_factions
-- ============================================================

create table if not exists public.faction_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  owner_email text,
  status text default 'draft',                 -- draft | pending | approved | rejected
  name text,
  color text,                                  -- rgba(...) для карты
  gov text, regime text, leader text, civ_type text,
  system_id text references public.map_systems(id) on delete set null,
  system_name text, planet_name text,
  buildings jsonb default '[]'::jsonb,
  bonus_money boolean default false,
  race text, ideology text, culture text, history text, link text, herald_url text,
  faction_id text, reviewed_by text, reject_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- флаг «внесены изменения, ждут проверки» (для редактирования уже одобренной)
alter table public.faction_applications add column if not exists pending_review boolean default false;

alter table public.faction_applications enable row level security;

drop policy if exists "fa_select" on public.faction_applications;
drop policy if exists "fa_insert" on public.faction_applications;
drop policy if exists "fa_update" on public.faction_applications;
drop policy if exists "fa_delete" on public.faction_applications;

-- читать: одобренные — всем; свою — автор; все — стафф
create policy "fa_select" on public.faction_applications for select to public
  using (status = 'approved'
         or owner_id = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));

-- создавать: только от своего имени
create policy "fa_insert" on public.faction_applications for insert to authenticated
  with check (owner_id = auth.uid());

-- править: автор (свою) или стафф
create policy "fa_update" on public.faction_applications for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- удалять: автор только черновик, либо стафф
create policy "fa_delete" on public.faction_applications for delete to authenticated
  using ((owner_id = auth.uid() and status = 'draft')
         or public.current_user_role() in ('superadmin','editor'));

-- ── RPC: одобрение анкеты (атомарно) ──
create or replace function public.approve_faction_application(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare app public.faction_applications; fid text;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: only superadmin/editor can approve';
  end if;
  select * into app from public.faction_applications where id = p_id;
  if not found then raise exception 'application not found'; end if;

  fid := 'fac_' || left(replace(p_id::text, '-', ''), 10);

  -- фракция на карте (цвет уже rgba)
  insert into public.map_factions (id, name, color, sort)
    values (fid, coalesce(app.name, 'Фракция'), coalesce(app.color, 'rgba(120,140,170,0.3)'), 100)
    on conflict (id) do update set name = excluded.name, color = excluded.color;

  -- занять систему
  if app.system_id is not null then
    update public.map_systems set faction = fid where id = app.system_id;
  end if;

  -- статус анкеты (сбрасываем флаг изменений)
  update public.faction_applications
    set status = 'approved', pending_review = false, faction_id = fid, reviewed_by = auth.jwt() ->> 'email', updated_at = now()
    where id = p_id;

  -- роль игрока (не понижая стафф/суперадмина)
  update public.user_roles set role = 'player' where user_id = app.owner_id and role = 'viewer';

  return fid;
end$$;

revoke all on function public.approve_faction_application(uuid) from public;
grant execute on function public.approve_faction_application(uuid) to authenticated;
