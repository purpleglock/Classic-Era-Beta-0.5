-- ============================================================
-- РЕГИСТРАЦИЯ ПО ПОЧТЕ С РУЧНЫМ ОДОБРЕНИЕМ
--
-- Схема: игрок регистрируется почтой+паролем → аккаунт создаётся сразу,
-- но клиент пишет строку в signup_requests (pending) и до одобрения
-- показывает экран ожидания. Админам летит сообщение в ВК (тем же
-- вебхуком, что тикеты). В «Управление → ПОЛЬЗ.» появляется блок заявок:
-- «Принять» (approve) или «Удалить» (сносит аккаунт целиком).
-- Google-входов гейт не касается — их provider != 'email'.
--
-- Требует public.current_user_role() (уже есть, из _admin_users.sql).
-- Выполнить целиком в Supabase → SQL Editor.
-- ============================================================

create table if not exists public.signup_requests (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  status     text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now()
);

alter table public.signup_requests enable row level security;

-- читать: свою строку (гейт на клиенте) или стафф (список заявок в админке)
drop policy if exists "sr_sel" on public.signup_requests;
create policy "sr_sel" on public.signup_requests for select to authenticated
  using (user_id = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));

-- вставлять: только свою строку и только pending (одобряет исключительно RPC)
drop policy if exists "sr_ins" on public.signup_requests;
create policy "sr_ins" on public.signup_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- update/delete политик нет: менять статус и сносить — только через RPC ниже.
grant select, insert on public.signup_requests to authenticated;

-- ── Принять заявку ──────────────────────────────────────────
create or replace function public.admin_approve_signup(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  update public.signup_requests set status = 'approved' where user_id = p_user_id;
  if not found then
    raise exception 'заявка не найдена';
  end if;
  -- Страховка: заведём строку роли, если её ещё нет. ON CONFLICT здесь нельзя —
  -- в user_roles нет уникального индекса по user_id (та же идиома, что в
  -- _faction_setup.sql / _admin_transfer.sql).
  if not exists (select 1 from public.user_roles where user_id = p_user_id) then
    insert into public.user_roles (user_id, role, is_banned) values (p_user_id, 'viewer', false);
  end if;
end$$;
revoke all on function public.admin_approve_signup(uuid) from public;
grant execute on function public.admin_approve_signup(uuid) to authenticated;

-- ── Отклонить заявку = удалить аккаунт целиком ──────────────
-- Жёсткий рычаг, поэтому только superadmin. Удаляет ТОЛЬКО аккаунты,
-- у которых есть строка в signup_requests (то есть почтовые заявки) —
-- снести Google-аккаунт этим RPC нельзя.
create or replace function public.admin_reject_signup(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if public.current_user_role() <> 'superadmin' then
    raise exception 'forbidden: superadmin only';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;
  if not exists (select 1 from public.signup_requests where user_id = p_user_id) then
    raise exception 'это не почтовая заявка — удалять нечего';
  end if;
  delete from public.user_roles where user_id = p_user_id;
  -- signup_requests уйдёт каскадом вместе с auth.users
  delete from auth.users where id = p_user_id;
end$$;
revoke all on function public.admin_reject_signup(uuid) from public;
grant execute on function public.admin_reject_signup(uuid) to authenticated;
