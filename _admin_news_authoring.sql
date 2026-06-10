-- ================================================================
-- ADMIN NEWS AUTHORING
-- Разрешаем стаффу (superadmin/editor/moderator) создавать новости
-- от лица НПС или любой фракции игрока — для выдачи ивентов и квестов.
-- Раньше fn_insert требовал owner_id = auth.uid() И собственную одобренную
-- фракцию, поэтому админ мог только модерировать чужие новости.
--
-- Применять в Supabase SQL Editor. Идемпотентно (drop/create).
-- ================================================================

drop policy if exists "fn_insert" on public.faction_news;

create policy "fn_insert" on public.faction_news for insert to authenticated
  with check (
    -- стафф: публикация от лица НПС (owner_id null) или любой фракции
    public.current_user_role() in ('superadmin','editor','moderator')
    -- игрок: только от своего имени и при наличии одобренной фракции
    or (
      owner_id = auth.uid()
      and exists (
        select 1 from public.faction_applications fa
        where fa.owner_id = auth.uid() and fa.status = 'approved'
      )
    )
  );

-- fn_update / fn_delete уже разрешают стаффу править/удалять любые строки
-- (см. _faction_news.sql), поэтому их менять не нужно.
-- Бан-блокировка (ban_no_insert, RESTRICTIVE) остаётся в силе поверх этой политики.
