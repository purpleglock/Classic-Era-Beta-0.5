-- ─────────────────────────────────────────────────────────────────────────────
-- spy_portraits: разрешить запись пула любому ЗАЛОГИНЕННОМУ пользователю.
--
-- Было: грузить/удалять портреты мог только стафф (superadmin/editor). Из-за
-- этого загрузка из админки молча падала на вставке в БД (файл в папку
-- сохранялся, а ряда в таблице не появлялось → портрет нигде не использовался).
--
-- Пул портретов — общий и безобидный (просто картинки оперативников), а сама
-- админ-вкладка и так доступна только из комнаты «Управление». Поэтому
-- ослабляем политику записи до «любой authenticated». Чтение и так у всех.
--
-- Применить в Supabase SQL editor один раз. Идемпотентно.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.spy_portraits enable row level security;

drop policy if exists "spy_portraits_sel" on public.spy_portraits;
drop policy if exists "spy_portraits_all" on public.spy_portraits;

-- Читать пул может кто угодно.
create policy "spy_portraits_sel" on public.spy_portraits for select
  using (true);

-- Загружать/менять/удалять — любой залогиненный (не только стафф).
create policy "spy_portraits_all" on public.spy_portraits for all to authenticated
  using (true)
  with check (true);
