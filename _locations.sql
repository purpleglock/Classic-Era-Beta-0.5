-- ============================================================
-- ЛОКАЦИИ — приватные форумные RP-страницы (page_type='location')
-- Посты локаций (записи в comments на страницах-локациях) доступны
-- ТОЛЬКО игрокам и администрации.
-- Применить один раз в Supabase -> SQL Editor.
-- Требует: public.pages(slug,page_type), public.current_user_role(),
--          public.comments(page_slug, as_location, ...)
-- ============================================================

-- 1) Флаг «пост от имени локации» (голос рассказчика/ГМ).
alter table public.comments add column if not exists as_location boolean default false;

-- 2) RESTRICTIVE-политики: добавляются к существующим (объединяются по AND),
--    поэтому обычные комментарии работают как раньше, а посты на странице
--    с page_type='location' доступны только роли «игрок и выше».

-- Чтение: посты локаций видят только игроки+ (включая блокировку анонимов -> to public).
drop policy if exists "cmt_loc_read" on public.comments;
create policy "cmt_loc_read" on public.comments
  as restrictive for select to public
  using (
    not exists (
      select 1 from public.pages pg
      where pg.slug = comments.page_slug and pg.page_type = 'location'
    )
    or public.current_user_role() in ('player','moderator','editor','superadmin')
  );

-- Запись: писать в локацию могут только игроки+; «от имени локации» (as_location=true)
--         разрешено только администрации (moderator/editor/superadmin).
drop policy if exists "cmt_loc_write" on public.comments;
create policy "cmt_loc_write" on public.comments
  as restrictive for insert to authenticated
  with check (
    (
      not exists (
        select 1 from public.pages pg
        where pg.slug = comments.page_slug and pg.page_type = 'location'
      )
      or public.current_user_role() in ('player','moderator','editor','superadmin')
    )
    and (
      coalesce(as_location, false) = false
      or public.current_user_role() in ('moderator','editor','superadmin')
    )
  );

-- Примечание: существующие permissive-политики comments (чтение всем,
-- вставка/правка/удаление владельцем и стаффом) НЕ изменяются — restrictive
-- лишь сужает доступ к постам страниц-локаций.
