-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🔒 СОВЕТНИК SUPABASE: 4 КРИТИЧЕСКИХ ЗАМЕЧАНИЯ (20.10)
-- ═══════════════════════════════════════════════════════════════════
-- 1–2) precursor_saga_wait / precursor_saga_reward — справочники саги
--      (часы ожидания узлов, награды за концовки) без RLS и с правами
--      INSERT/UPDATE/DELETE у anon и authenticated: любой, у кого есть
--      публичный ключ сайта, мог переписать ожидания и награды.
--      Стало: RLS + политика «читать всем», запись у клиентов отозвана.
--      Сага читает их через _pc_saga_wait (invoker — политика чтения ей
--      хватает) и _pc_saga_pay (definer) — обе продолжают работать.
--
-- 3) _v_colony_enclaves — SECURITY DEFINER-представление. Его таблицы
--    (colonies, map_systems) и так открыты на чтение всем, поэтому перевод
--    в security_invoker ничего не меняет в выдаче. Лишние права на запись
--    отзываем.
--
-- 4) public_profiles — витрина ника и аватара без email (_author_id_privacy).
--    Определение «от владельца» было нужно намеренно: сами profiles игрок
--    видит только свои. НО представление над одной таблицей — обновляемое,
--    у anon были права UPDATE/INSERT/DELETE, а владелец (postgres) обходит
--    RLS. То есть через витрину можно было менять и удалять ЧУЖИЕ профили.
--    Стало: выдачу делает функция _public_profiles() (definer, только три
--    безопасных поля), а сама витрина — обычное invoker-представление над
--    ней. Колонки те же, клиент (auth.js → dbGet('public_profiles')) не
--    меняется; писать через неё больше нельзя в принципе.
--
-- Идемпотентно.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1–2. Справочники саги ────────────────────────────────────
alter table public.precursor_saga_wait   enable row level security;
alter table public.precursor_saga_reward enable row level security;

drop policy if exists saga_wait_read on public.precursor_saga_wait;
create policy saga_wait_read on public.precursor_saga_wait for select using (true);
drop policy if exists saga_reward_read on public.precursor_saga_reward;
create policy saga_reward_read on public.precursor_saga_reward for select using (true);

revoke insert, update, delete, truncate, references, trigger
  on public.precursor_saga_wait, public.precursor_saga_reward from anon, authenticated;

-- ── 3. Анклавы колоний ───────────────────────────────────────
alter view public._v_colony_enclaves set (security_invoker = on);
revoke insert, update, delete, truncate, references, trigger
  on public._v_colony_enclaves from anon, authenticated;

-- ── 4. Публичная витрина профилей ────────────────────────────
create or replace function public._public_profiles()
returns table (user_id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url
    from public.profiles p
   where p.user_id is not null
$$;
revoke all on function public._public_profiles() from public;
grant execute on function public._public_profiles() to anon, authenticated;

create or replace view public.public_profiles with (security_invoker = on) as
  select user_id, display_name, avatar_url from public._public_profiles();

revoke insert, update, delete, truncate, references, trigger
  on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
