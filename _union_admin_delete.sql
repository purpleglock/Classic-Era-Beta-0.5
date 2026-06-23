-- ============================================================
-- ДИПЛОМАТИЯ · СОЮЗЫ — АДМИН: УДАЛЕНИЕ СОЮЗА ИЗ «УПРАВЛЕНИЯ»
-- Применять в Supabase → SQL Editor ПОСЛЕ _diplo_unions.sql и
-- _diplo_union_moderation.sql. Идемпотентно.
--
-- Стафф (superadmin/editor/moderator) может полностью снести любой союз
-- из админ-панели «Управление». Участники (diplo_members) и приглашения
-- (diplo_invites) уходят каскадом (ON DELETE CASCADE из _diplo_unions.sql).
-- Вассальные пакты — отдельная сущность, их союз не трогает.
-- ============================================================

create or replace function public.union_delete(p_union_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.diplo_unions;
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  select * into u from public.diplo_unions where id = p_union_id;
  if not found then raise exception 'union not found'; end if;
  delete from public.diplo_unions where id = p_union_id;   -- members/invites → каскад
  return jsonb_build_object('ok', true, 'deleted', p_union_id, 'name', u.name);
end$$;
revoke all on function public.union_delete(uuid) from public;
grant execute on function public.union_delete(uuid) to authenticated;

-- ── Реестр ВСЕХ союзов для админ-панели (включая pending/rejected) ──
-- Зеркало union_list, но без фильтра по статусу и только для стаффа.
create or replace function public.union_admin_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_role() in ('superadmin','editor','moderator')
    then coalesce((select jsonb_agg(row order by (row->>'name')) from (
      select jsonb_build_object(
        'id', u.id, 'kind', u.kind, 'name', u.name, 'status', u.status,
        'color', u.color, 'herald_url', u.herald_url,
        'leader_fid', u.leader_fid, 'leader_name', public._fac_name(u.leader_fid),
        'members', (select count(*) from public.diplo_members m where m.union_id = u.id),
        'created_at', u.created_at
      ) as row
      from public.diplo_unions u
    ) rows), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke all on function public.union_admin_list() from public;
grant execute on function public.union_admin_list() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public.union_admin_list();              -- под стаффом: все союзы
-- select public.union_delete('<id>'::uuid);       -- снести союз
