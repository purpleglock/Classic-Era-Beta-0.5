-- ============================================================
-- АДМИН-УПРАВЛЕНИЕ ПРОФИЛЯМИ (имя / удаление).
--
-- Причина бага: смена ника чужого профиля шла POST-ом с
-- Prefer: resolution=merge-duplicates. PostgREST резолвит конфликт
-- по первичному ключу таблицы (не по email), поэтому upsert не
-- находил существующую строку и пытался вставить новую с уже
-- занятым email → ERROR duplicate key "profiles_email_key".
--
-- Решение: SECURITY DEFINER функции — обходят RLS, проверяют, что
-- вызывающий superadmin, и делают явный UPDATE по email (INSERT,
-- только если профиля ещё нет). Выполнить целиком в Supabase SQL Editor.
-- ============================================================

-- Сменить отображаемое имя профиля по email.
create or replace function public.admin_set_profile_name(p_email text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin') then
    raise exception 'forbidden: superadmin only';
  end if;
  if p_email is null or p_email = '' then
    raise exception 'email required';
  end if;
  update public.profiles set display_name = p_name where email = p_email;
  if not found then
    insert into public.profiles (email, display_name) values (p_email, p_name);
  end if;
end$$;
revoke all on function public.admin_set_profile_name(text, text) from public;
grant execute on function public.admin_set_profile_name(text, text) to authenticated;

-- Удалить профиль игрока по email (имя/аватар; аккаунт и роль не трогаются).
create or replace function public.admin_delete_profile(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin') then
    raise exception 'forbidden: superadmin only';
  end if;
  delete from public.profiles where email = p_email;
end$$;
revoke all on function public.admin_delete_profile(text) from public;
grant execute on function public.admin_delete_profile(text) to authenticated;
