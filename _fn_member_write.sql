-- ============================================================
-- ВЕСТНИК: писать может не только владелец державы
-- ============================================================
-- Было: fn_insert требовал СВОЮ одобренную анкету (faction_applications.owner_id
-- = auth.uid()). Служащий чужой державы (_faction_members.sql) своей анкеты не
-- имеет вовсе — как и владелец присоединённой державы, чья анкета уходит в
-- status='annexed' (_annex.sql), а сам он садится соправителем. Обоим сервер
-- отвечал 42501, а клиент звал «зарегистрируйте фракцию».
-- Стало: пишет владелец ИЛИ служащий с правом 'news' — и только от лица ТОЙ
-- державы, к которой он приписан (faction_id проверяется, чужой герб не подставить).
-- Модерация не трогается: строка всё так же уходит в pending.

drop policy if exists "fn_insert" on public.faction_news;
create policy "fn_insert" on public.faction_news for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (
      exists (
        select 1 from public.faction_applications fa
        where fa.owner_id = auth.uid() and fa.status = 'approved'
          and (faction_news.faction_id is null or faction_news.faction_id = fa.faction_id)
      )
      or (
        'news' = any(public._fm_my_perms())
        and faction_news.faction_id is not null
        and faction_news.faction_id = public._fm_member_fid()
      )
    )
  );

-- Читать «свои» новости державы (в т.ч. чужие черновики на модерации) —
-- всем, у кого есть право 'news' в этой державе: редакция общая, иначе
-- соправитель не видит, что уже отправлено, и дублирует депеши.
drop policy if exists "fn_select" on public.faction_news;
create policy "fn_select" on public.faction_news for select to public
  using (status = 'approved'
         or owner_id = auth.uid()
         or (faction_news.faction_id is not null
             and faction_news.faction_id = public._ec_my_fid_opt()
             and 'news' = any(public._fm_my_perms()))
         or public.current_user_role() in ('superadmin','editor','moderator'));

-- Править/удалять — автор своей строки (как было) либо носитель 'news' в той же
-- державе: правитель должен уметь отозвать депешу, отправленную его дипломатом.
drop policy if exists "fn_update" on public.faction_news;
create policy "fn_update" on public.faction_news for update to authenticated
  using (owner_id = auth.uid()
         or (faction_news.faction_id is not null
             and faction_news.faction_id = public._ec_my_fid_opt()
             and 'news' = any(public._fm_my_perms()))
         or public.current_user_role() in ('superadmin','editor','moderator'))
  with check (owner_id = auth.uid()
         or (faction_news.faction_id is not null
             and faction_news.faction_id = public._ec_my_fid_opt()
             and 'news' = any(public._fm_my_perms()))
         or public.current_user_role() in ('superadmin','editor','moderator'));

drop policy if exists "fn_delete" on public.faction_news;
create policy "fn_delete" on public.faction_news for delete to authenticated
  using (owner_id = auth.uid()
         or (faction_news.faction_id is not null
             and faction_news.faction_id = public._ec_my_fid_opt()
             and 'news' = any(public._fm_my_perms()))
         or public.current_user_role() in ('superadmin','editor','moderator'));
