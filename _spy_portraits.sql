-- ============================================================================
--  _spy_portraits.sql  —  БИБЛИОТЕКА ПОРТРЕТОВ ОПЕРАТИВНИКОВ  +  БУСТ ОБУЧЕНИЯ
--  Применять в Supabase ПОСЛЕ всей ветки _spy_agents6→7→8.sql.
--  Самодостаточный слайс: ничего из агентурной логики не пересоздаёт,
--  кроме одной справочной функции опыта (_spy_op_xp) — безопасно для надмножеств.
--
--  ЧТО ДЕЛАЕТ:
--   1) Таблица public.spy_portraits — общий (глобальный) пул портретов.
--      Каждый портрет помечен расой и (необязательно) полом. Клиент сам
--      детерминированно подбирает портрет агенту по его расе/полу (seed = id),
--      поэтому НИ колонок в spy_agents/spy_recruits, НИ переписи генераторов
--      не требуется. Загрузкой портретов рулит админка (admin.js).
--   2) Буст тайного обучения: XP за «train» поднят 60 → 150 (1 ход обучения
--      теперь = уверенный левел-ап с 1-го на 2-й уровень).
-- ============================================================================

-- ── 1. Пул портретов ────────────────────────────────────────────────────────
create table if not exists public.spy_portraits (
  id          uuid primary key default gen_random_uuid(),
  race        text,                       -- раса (Человек/Синтет/Зоранин/…); null = подходит любой
  gender      text,                       -- пол (муж./жен./агендер);          null = любой
  url         text not null,              -- публичный URL изображения (Storage / R2)
  label       text,                       -- подпись/имя файла для админки
  created_by  uuid default auth.uid(),
  created_at  timestamptz default now()
);
create index if not exists spy_portraits_race_idx on public.spy_portraits(race);

alter table public.spy_portraits enable row level security;
-- Читать пул может кто угодно (игроку нужно показать портрет своего агента);
-- ЗАГРУЖАТЬ/УДАЛЯТЬ — только стафф.
drop policy if exists "spy_portraits_sel" on public.spy_portraits;
drop policy if exists "spy_portraits_all" on public.spy_portraits;
create policy "spy_portraits_sel" on public.spy_portraits for select
  using (true);
create policy "spy_portraits_all" on public.spy_portraits for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 2. Буст опыта обучения (надмножество _spy_agents6.sql) ───────────────────
-- Полностью повторяет каталог опыта операций, поднят только «train».
create or replace function public._spy_op_xp(p_op text)
returns numeric language sql immutable as $$
  select (case p_op
    when 'recon_basic'   then 12 when 'recon_deep'    then 22
    when 'steal_gc'      then 25 when 'steal_res'     then 25
    when 'sabotage'      then 30 when 'destabilize'   then 30
    when 'kill_agent'    then 35 when 'faith_impose'  then 30
    when 'steal_tech'    then 45 when 'mass_demolish' then 40
    when 'train'         then 150              -- было 60: обучение даёт ощутимый рост
    else 15 end)::numeric
$$;

-- Примечание: spy_train по-прежнему стоит 120 ГС/агента и длится 2 хода
-- (success_pct=100), поэтому весь XP (150) начисляется гарантированно.
