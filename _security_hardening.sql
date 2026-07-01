-- © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
-- ════════════════════════════════════════════════════════════════════════════
-- _security_hardening.sql — СЕРВЕРНАЯ часть закрытия аудита безопасности.
-- Клиентский XSS уже закрыт в коде (jsq/safeAvatar/CSP, сборка 20260701xss).
-- Здесь — то, что можно сделать ТОЛЬКО в Supabase (RLS, Storage, гонки, rate-limit).
--
-- ⚠️  Я НЕ ВИЖУ ВАШУ ЖИВУЮ БД. Порядок работы строго такой:
--   1) Выполните БЛОК 0 (АУДИТ) — он ничего не меняет, только показывает реальную
--      картину: где RLS выключен и какие политики пускают anon/public на чтение.
--   2) Сверьте вывод с БЛОКами ниже и применяйте их ПО ОДНОМУ, проверяя сайт после
--      каждого. Всё написано идемпотентно (drop policy if exists → create).
--   3) БЛОК 6 (rate-limit) — НЕ SQL, делается в Dashboard, инструкция внутри.
--
-- Откат любого блока: удалить созданные политики и, при желании,
-- `alter table ... disable row level security;` (вернёт прежнее поведение).
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 0 — АУДИТ (только чтение, безопасно). Выполните и прочитайте вывод.
-- ════════════════════════════════════════════════════════════════════════════

-- 0.1 — У каких таблиц public RLS ВЫКЛЮЧЕН (rowsecurity=false = читают/пишут все):
select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_on,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- 0.2 — Какие политики пускают на SELECT роль anon или public (публичное чтение):
--       смотрите на sensitive-таблицы: user_roles, profiles, faction_economy,
--       colonies, unit_production. Для pages/sections/comments/map_systems
--       публичное чтение — ЭТО НОРМА (вики открыта), их трогать не нужно.
select schemaname, tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and cmd in ('SELECT','ALL')
order by tablename, policyname;

-- 0.3 — Политики на запись (INSERT/UPDATE/DELETE), у которых нет проверки владельца/роли
--       (qual/with_check = null или true = пишет кто угодно):
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
order by tablename, cmd;

-- Дальше применяйте блоки, только если аудит подтвердил проблему для конкретной таблицы.


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 1 — user_roles: скрыть «кто админ / кто забанен» от посторонних.  (аудит №2)
-- Безопасно: current_user_role() — SECURITY DEFINER, читает user_roles в обход RLS,
-- поэтому разрешение ролей НЕ сломается. Клиент (loadUserRole) читает ТОЛЬКО свою
-- строку (user_id = auth.uid()) — политика ниже это разрешает.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.user_roles enable row level security;

drop policy if exists "ur_sel"        on public.user_roles;
drop policy if exists "user_roles_sel" on public.user_roles;   -- на случай прежних имён
create policy "ur_sel" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() in ('superadmin','moderator'));

-- запись — только суперадмину (роли раздаёт он)
drop policy if exists "ur_write" on public.user_roles;
create policy "ur_ins" on public.user_roles for insert to authenticated
  with check (public.current_user_role() = 'superadmin');
create policy "ur_upd" on public.user_roles for update to authenticated
  using  (public.current_user_role() = 'superadmin')
  with check (public.current_user_role() = 'superadmin');
create policy "ur_del" on public.user_roles for delete to authenticated
  using  (public.current_user_role() = 'superadmin');


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 2 — profiles: перестать отдавать e-mail анонимам, НЕ ломая публичный
-- показ имён/аватаров контрибьюторов.  (аудит №2, утечка почт)
--
-- ⚠️ ТРЕБУЕТ маленькой правки клиента, поэтому по умолчанию ЗАКОММЕНТИРОВАНО.
-- Идея: завести VIEW public_profiles ТОЛЬКО с безопасными колонками
-- (display_name, avatar_url — без email), отдать её публике, а саму таблицу
-- profiles закрыть до владельца/штаба. Затем в клиенте заменить чтения
-- 'profiles?select=...' там, где нужны чужие профили, на 'public_profiles'.
--
-- Если готовы — раскомментируйте и синхронизируйте клиент:
--
-- create or replace view public.public_profiles
--   with (security_invoker = true) as
--   select display_name, avatar_url from public.profiles;
-- grant select on public.public_profiles to anon, authenticated;
--
-- alter table public.profiles enable row level security;
-- drop policy if exists "prof_sel_all" on public.profiles;
-- create policy "prof_sel_self" on public.profiles for select to authenticated
--   using (email = (auth.jwt() ->> 'email') or public.current_user_role() in ('superadmin','moderator'));
-- create policy "prof_upsert_self" on public.profiles for insert to authenticated
--   with check (email = (auth.jwt() ->> 'email'));
-- create policy "prof_update_self" on public.profiles for update to authenticated
--   using (email = (auth.jwt() ->> 'email')) with check (email = (auth.jwt() ->> 'email'));
--
-- ПРИМЕЧАНИЕ: набор колонок profiles уточните по своей схеме (тут предполагаются
-- email/display_name/avatar_url). Пока блок не применён — почты остаются видимыми.


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 3 — Storage (bucket wiki-images): серверный лимит типа и размера.  (аудит №14)
-- Это НАСТОЯЩИЙ лимит (клиентский в ceUploadImage легко обойти). SVG исключён —
-- он мог бы нести скрипт. Меняем сам бакет — политики трогать не нужно.
-- ════════════════════════════════════════════════════════════════════════════
update storage.buckets
set public = true,
    file_size_limit = 10485760,  -- 10 МБ
    allowed_mime_types = array['image/jpeg','image/png','image/gif','image/webp']
where id = 'wiki-images';

-- Записывать в бакет — только вошедшим; читать — всем.  (аудит №13)
alter table storage.objects enable row level security;
drop policy if exists "wiki_images_read"   on storage.objects;
drop policy if exists "wiki_images_write"  on storage.objects;
drop policy if exists "wiki_images_update" on storage.objects;
drop policy if exists "wiki_images_delete" on storage.objects;
create policy "wiki_images_read" on storage.objects for select to public
  using (bucket_id = 'wiki-images');
create policy "wiki_images_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'wiki-images');
create policy "wiki_images_update" on storage.objects for update to authenticated
  using (bucket_id = 'wiki-images' and public.current_user_role() in ('superadmin','editor','moderator'));
create policy "wiki_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wiki-images' and public.current_user_role() in ('superadmin','editor','moderator'));
-- ⚠️ Если бакет называется иначе или их несколько — поправьте 'wiki-images'.


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 4 — site_settings и sections: чтение всем, запись только штабу.  (аудит №19, №20)
-- ВАЖНО: включаем RLS ВМЕСТЕ с публичной политикой SELECT, иначе сайт «ослепнет»
-- (эти таблицы читаются на каждой загрузке). Проверьте в БЛОКе 0.3, нет ли уже
-- «широкой» политики записи — если есть, удалите её (drop policy ...), иначе она
-- продолжит пускать всех (политики складываются по ИЛИ).
-- ════════════════════════════════════════════════════════════════════════════
-- site_settings
alter table public.site_settings enable row level security;
drop policy if exists "ss_sel" on public.site_settings;
create policy "ss_sel" on public.site_settings for select to public using (true);
drop policy if exists "ss_ins" on public.site_settings;
drop policy if exists "ss_upd" on public.site_settings;
drop policy if exists "ss_del" on public.site_settings;
create policy "ss_ins" on public.site_settings for insert to authenticated
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "ss_upd" on public.site_settings for update to authenticated
  using  (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "ss_del" on public.site_settings for delete to authenticated
  using  (public.current_user_role() = 'superadmin');

-- sections
alter table public.sections enable row level security;
drop policy if exists "sec_sel" on public.sections;
create policy "sec_sel" on public.sections for select to public using (true);
drop policy if exists "sec_ins" on public.sections;
drop policy if exists "sec_upd" on public.sections;
drop policy if exists "sec_del" on public.sections;
create policy "sec_ins" on public.sections for insert to authenticated
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "sec_upd" on public.sections for update to authenticated
  using  (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "sec_del" on public.sections for delete to authenticated
  using  (public.current_user_role() in ('superadmin','editor'));


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 5 — Гонки в денежных RPC (аудит №15). НЕ автоматизируется вслепую.
-- Хорошая новость: в economy-функциях вы УЖЕ используете блокировку строки, напр.
--   select * into me from public.faction_economy where faction_id=... FOR UPDATE;
-- Проверьте, что КАЖДЫЙ RPC, который списывает/начисляет ресурсы (покупки, биржа,
-- переводы, займы, найм), делает `... FOR UPDATE` по строке faction_economy ДО
-- изменения баланса — тогда параллельные вызовы не «раздвоят» деньги.
-- Найти кандидатов без блокировки:
--   grep -L "for update" _*.sql | по файлам, где есть update faction_economy set gc
-- Добавляйте FOR UPDATE точечно в те функции, что его не имеют.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- БЛОК 6 — rate-limit регистрации/входа (аудит №16, №17). ЭТО НЕ SQL.
-- Supabase Dashboard → Authentication → Rate Limits:
--   • «Sign up / Sign in» — снизьте лимит запросов с IP (напр. 5–10 / час).
--   • Включите защиту от подбора (leaked-password protection, если доступно).
-- Dashboard → Authentication → Providers → Email:
--   • Обязательное подтверждение e-mail (confirm email) — отсекает масс-регистрацию.
-- Опционально: включите CAPTCHA (hCaptcha/Turnstile) на формах входа/регистрации.
-- ════════════════════════════════════════════════════════════════════════════


-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ────────────────────────────────────────────────
-- Повторите БЛОК 0 — sensitive-таблицы больше не должны иметь SELECT для anon/public,
-- а запись везде должна требовать владельца или роль штаба.
-- Зайдите на сайт как ГОСТЬ (без логина): вики, секции, новости должны читаться;
-- e-mail'ы в контрибьюторах (если применили БЛОК 2) — исчезнуть.
