-- ============================================================
-- ЖЁСТКАЯ БЛОКИРОВКА ЗАБАНЕННЫХ НА УРОВНЕ БД (RLS)
--
-- Клиентский оверлей (auth.js) — только UX. Реальную защиту даёт этот файл.
-- Два рычага:
--   1) current_user_role() для забаненного возвращает 'banned' — сентинел,
--      которого нет НИ В ОДНОМ allow-list. Мгновенно снимает все права роли
--      (стафф/игрок/локации/правка карты) во всех политиках и SECURITY DEFINER
--      RPC, которые сверяются с ролью.
--   2) RESTRICTIVE write-политики (объединяются по AND с существующими) на
--      таблицах с доступом «по владельцу» — там роль не проверяется, поэтому
--      добавляем явный запрет not current_user_banned().
--
-- Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── Хелпер: забанен ли текущий пользователь ─────────────────
create or replace function public.current_user_banned()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and is_banned = true
  )
$$;
grant execute on function public.current_user_banned() to anon, authenticated;

-- Ассерт для SECURITY DEFINER RPC (экономика/шпионаж/торговля), которые
-- идентифицируют актора по владельцу и не сверяются с ролью. Эти RPC обходят
-- RLS, поэтому им нужен явный guard — вставляется в тела (см. _economy_setup.sql).
create or replace function public.assert_not_banned()
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_banned() then
    raise exception 'forbidden: account banned';
  end if;
end$$;
grant execute on function public.assert_not_banned() to authenticated;

-- ── Переопределение current_user_role() ─────────────────────
-- Забанен → 'banned'. Иначе — сохранённая роль (или 'viewer', если строки нет).
-- Для НЕзабаненных поведение не меняется: все политики сверяют роль через
-- «role in (...)», где 'viewer'/NULL одинаково не попадают в стафф-списки.
create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and is_banned = true
    ) then 'banned'
    else coalesce(
      (select role from public.user_roles where user_id = auth.uid() limit 1),
      'viewer'
    )
  end
$$;
grant execute on function public.current_user_role() to anon, authenticated;

-- ── RESTRICTIVE-запрет записи для забаненных ────────────────
-- Блокируем INSERT/UPDATE/DELETE (SELECT не трогаем — забаненный и так может
-- читать публичную вики, как аноним; а приватное закрывается рычагом №1).
do $$
declare t text;
begin
  foreach t in array array[
    'comments',              -- комментарии и RP-посты локаций
    'faction_applications',  -- анкеты (регистрация/правка фракции)
    'faction_units',         -- дизайны юнитов
    'faction_economy',       -- казна/ресурсы/исследования
    'colonies',              -- колонии
    'colony_buildings'       -- постройки
  ] loop
    execute format('drop policy if exists "ban_no_insert" on public.%I', t);
    execute format('drop policy if exists "ban_no_update" on public.%I', t);
    execute format('drop policy if exists "ban_no_delete" on public.%I', t);
    execute format('create policy "ban_no_insert" on public.%I as restrictive for insert to authenticated with check (not public.current_user_banned())', t);
    execute format('create policy "ban_no_update" on public.%I as restrictive for update to authenticated using (not public.current_user_banned()) with check (not public.current_user_banned())', t);
    execute format('create policy "ban_no_delete" on public.%I as restrictive for delete to authenticated using (not public.current_user_banned())', t);
  end loop;
end$$;

-- ── Проверка после применения (необязательно) ───────────────
-- select public.current_user_role(), public.current_user_banned();
