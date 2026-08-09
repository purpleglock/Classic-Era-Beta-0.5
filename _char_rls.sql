-- Регистрация персонажа упиралась в RLS: на pages/characters были только
-- админские политики (superadmin/editor/moderator), а мастер регистрации
-- пишет обе таблицы от лица обычного игрока → 42501 "new row violates
-- row-level security policy for table pages".
-- Даём игроку право завести и править СВОЮ анкету — и только её.

-- ── pages: собственная страница-персонаж ──────────────────────────
drop policy if exists "char_own_insert" on public.pages;
create policy "char_own_insert" on public.pages
  for insert to authenticated
  with check (page_type = 'character' and author_id = auth.uid());

drop policy if exists "char_own_update" on public.pages;
create policy "char_own_update" on public.pages
  for update to authenticated
  using      (page_type = 'character' and author_id = auth.uid())
  with check (page_type = 'character' and author_id = auth.uid());

-- ── characters: собственная строка ───────────────────────────────
drop policy if exists "char_own_insert" on public.characters;
create policy "char_own_insert" on public.characters
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "char_own_update" on public.characters;
create policy "char_own_update" on public.characters
  for update to authenticated
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());
