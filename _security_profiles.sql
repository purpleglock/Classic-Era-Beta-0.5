-- ============================================================
-- БЕЗОПАСНОСТЬ: profiles — снять открытую на весь мир запись.
--
-- ДЫРА (найдена аудитом _security_rls_audit.sql 2026-07-06):
--   policy "self insert"  INSERT  with check (true)
--   policy "self update"  UPDATE  using (true)   ← и БЕЗ with check!
-- Любой залогиненный игрок из консоли может переписать ЛЮБОЙ чужой
-- профиль (display_name, avatar_url, email!) или навставлять строк
-- от чужого имени:
--   dbPatch('profiles','email=eq.жертва@…',{display_name:'…',avatar_url:'…'})
--
-- ПОЧЕМУ МОЖНО ПРОСТО СНЕСТИ, НИЧЕГО НЕ ЗАМЕНЯЯ:
-- все легальные записи в profiles давно идут через SECURITY DEFINER RPC,
-- которые обходят RLS и сами проверяют права:
--   • set_my_profile(p_name,p_avatar)  — игрок, email строго из JWT
--     (auth.js saveProfileFromForm → rpc/set_my_profile);
--   • admin_set_profile_name(...) и пр. — стафф (_admin_profiles.sql).
-- Прямых dbPost/dbPatch('profiles') в клиенте НЕТ (проверено по *.js).
-- SELECT-политика prof_sel_own_or_staff не трогается.
--
-- Применить в Supabase SQL editor один раз. Идемпотентно.
-- Если упало с "lock timeout" — гонка с трафиком, запустить ещё раз.
-- ============================================================

set lock_timeout = '4s';

drop policy if exists "self insert" on public.profiles;
drop policy if exists "self update" on public.profiles;

-- ── Проверка после применения ───────────────────────────────
-- Под обычным игроком в консоли:
--   dbPatch('profiles','user_id=neq.'+user.id,{display_name:'hacked'})
--     → 0 строк изменено / 403
-- Сохранение СВОЕГО профиля через модалку (шестерёнка → Профиль) — работает
-- (идёт через rpc/set_my_profile). Смена ника из админки — работает.
