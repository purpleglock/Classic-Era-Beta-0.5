-- ============================================================
-- ФИКС: admin_approve_signup падал с
--   «there is no unique or exclusion constraint matching the ON CONFLICT specification»
-- Причина: в public.user_roles нет уникального индекса по user_id,
-- поэтому ON CONFLICT (user_id) там неприменим. Заменено на проверку
-- not exists — та же идиома, что в _faction_setup.sql и _admin_transfer.sql.
--
-- Выполнить в Supabase → SQL Editor (можно поверх уже применённого
-- _email_signup_approval.sql — функция просто перезапишется).
-- ============================================================

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
  if not exists (select 1 from public.user_roles where user_id = p_user_id) then
    insert into public.user_roles (user_id, role, is_banned) values (p_user_id, 'viewer', false);
  end if;
end$$;
revoke all on function public.admin_approve_signup(uuid) from public;
grant execute on function public.admin_approve_signup(uuid) to authenticated;
