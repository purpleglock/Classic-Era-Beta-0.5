-- ============================================================
-- АДМИН-УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
--
-- Чинит три бага вкладки «ПОЛЬЗ.»:
--   1) Неверные роли у людей — старый JS УГАДЫВАЛ связь user_id↔email
--      по числу страниц. Здесь связь берётся из auth.users (источник истины),
--      джойн делается на сервере.
--   2) Бан не срабатывал — write в чужую строку user_roles блокировал RLS,
--      а модалка всегда сбрасывала статус. SECURITY DEFINER RPC обходит RLS.
--   3) Не было видно, чьи анкеты удаляли — добавлен аудит faction_deletions.
--
-- Выполнить целиком в Supabase → SQL Editor.
-- ============================================================

-- ── Аудит удалённых фракций ─────────────────────────────────
create table if not exists public.faction_deletions (
  id           uuid primary key default gen_random_uuid(),
  faction_id   text,
  faction_name text,
  owner_id     uuid,
  owner_email  text,
  deleted_by   text,
  deleted_at   timestamptz default now()
);
create index if not exists fd_owner_idx on public.faction_deletions(owner_id);

alter table public.faction_deletions enable row level security;
drop policy if exists "fd_sel" on public.faction_deletions;
-- читать: только стафф (история — служебная информация)
create policy "fd_sel" on public.faction_deletions for select to authenticated
  using (public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Список пользователей (надёжный, с реальной связью user_id↔email) ──
create or replace function public.admin_list_users()
returns table (
  user_id          uuid,
  email            text,
  role             text,
  is_banned        boolean,
  display_name     text,
  avatar_url       text,
  faction_name     text,     -- текущая одобренная фракция (или null)
  faction_status   text,     -- статус анкеты: approved|pending|draft|rejected|null
  deleted_factions text[]    -- имена ранее удалённых анкет
)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  return query
  select
    au.id,
    au.email::text,
    coalesce(ur.role, 'viewer'),
    coalesce(ur.is_banned, false),
    pr.display_name,
    pr.avatar_url,
    fa.name,
    fa.status,
    coalesce(fd.names, array[]::text[])
  from auth.users au
  left join public.user_roles ur on ur.user_id = au.id
  left join public.profiles   pr on pr.email   = au.email
  left join lateral (
    select a.name, a.status
    from public.faction_applications a
    where a.owner_id = au.id
    order by (a.status = 'approved') desc, a.updated_at desc
    limit 1
  ) fa on true
  left join lateral (
    select array_agg(d.faction_name order by d.deleted_at desc) as names
    from public.faction_deletions d
    where d.owner_id = au.id
  ) fd on true
  order by
    case coalesce(ur.role, 'viewer')
      when 'superadmin' then 0 when 'editor' then 1
      when 'moderator'  then 2 when 'player' then 3 else 4 end,
    au.email;
end$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- ── Бан / разбан пользователя (обходит RLS) ─────────────────
-- Ставит флаг is_banned (для RLS-рычагов из _ban_enforcement.sql) И
-- auth.users.banned_until (встроенный бан GoTrue: блокирует вход и обновление
-- токена — настоящая блокировка аккаунта на уровне провайдера).
create or replace function public.admin_set_user_ban(p_user_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin') then
    raise exception 'forbidden: superadmin only';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;
  update public.user_roles set is_banned = p_banned where user_id = p_user_id;
  if not found then
    insert into public.user_roles (user_id, role, is_banned) values (p_user_id, 'viewer', p_banned);
  end if;
  -- GoTrue-уровень: забанен → токены не выдаются и не обновляются
  update auth.users
    set banned_until = case when p_banned then 'infinity'::timestamptz else null end
    where id = p_user_id;
end$$;
revoke all on function public.admin_set_user_ban(uuid, boolean) from public;
grant execute on function public.admin_set_user_ban(uuid, boolean) to authenticated;
