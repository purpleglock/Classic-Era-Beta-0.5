-- ============================================================
-- БЕЗОПАСНОСТЬ: spy_portraits — закрыть открытую на весь мир запись.
--
-- ДЫРА: _spy_portraits_open_upload.sql поставил using(true)/with check(true)
-- для INSERT/UPDATE/DELETE любому authenticated. «Вкладка только в админке» —
-- это клиентский гейт; из консоли браузера ЛЮБОЙ игрок может:
--   dbDel('spy_portraits','id=gt.0')  → стереть весь пул портретов
--   dbPatch('spy_portraits',...,{url:'…'}) → подменить картинки всем
--
-- ФИКС (сохраняет починку молчаливой загрузки, ради которой открывали):
--   • SELECT — всем (как было);
--   • INSERT — любой authenticated, но только от своего имени
--     (created_by = auth.uid(); дефолт колонки это и делает);
--   • UPDATE/DELETE — автор строки или стафф.
-- Худший вектор после фикса — мусорные строки в пуле (чистит стафф),
-- чужое портить нельзя.
--
-- Применить в Supabase SQL editor один раз. Идемпотентно.
-- Применять ВМЕСТО / ПОВЕРХ _spy_portraits_open_upload.sql.
--
-- ⚠ Если упало с "deadlock detected" или "lock timeout" — это гонка с живым
--   трафиком за блокировку таблицы, ничего не применилось и не сломалось.
--   Просто запустить ещё раз (можно несколько раз, скрипт идемпотентен).
-- ============================================================

-- Не висеть в очереди за блокировкой (и не ловить дедлок), а быстро упасть
-- и дать себя перезапустить.
set lock_timeout = '4s';

-- RLS на spy_portraits уже включён прошлыми миграциями (_spy_portraits.sql /
-- _spy_portraits_open_upload.sql) — повторный ALTER не делаем, чтобы не брать
-- лишний эксклюзивный замок под трафиком.

drop policy if exists "spy_portraits_sel" on public.spy_portraits;
drop policy if exists "spy_portraits_all" on public.spy_portraits;
drop policy if exists "spy_portraits_ins" on public.spy_portraits;
drop policy if exists "spy_portraits_upd" on public.spy_portraits;
drop policy if exists "spy_portraits_del" on public.spy_portraits;

-- Читать пул может кто угодно.
create policy "spy_portraits_sel" on public.spy_portraits for select
  using (true);

-- Загружать может любой залогиненный, но только от своего имени.
create policy "spy_portraits_ins" on public.spy_portraits for insert to authenticated
  with check (created_by = auth.uid());

-- Менять/удалять — только автор строки или стафф.
create policy "spy_portraits_upd" on public.spy_portraits for update to authenticated
  using    (created_by = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'))
  with check (created_by = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

create policy "spy_portraits_del" on public.spy_portraits for delete to authenticated
  using (created_by = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Проверка после применения ───────────────────────────────
-- Под обычным игроком в консоли:
--   dbDel('spy_portraits','created_by=neq.'+user.id)  → 0 строк удалено
--   dbPost('spy_portraits',{url:'x',created_by:'<чужой uuid>'}) → 403
-- Загрузка из админки под стаффом — работает как раньше.
