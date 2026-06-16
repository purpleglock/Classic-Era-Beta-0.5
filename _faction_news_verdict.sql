-- ================================================================
-- FACTION NEWS — вердикт администрации
-- Комментарий стаффа в статье + журнал выдач из панели управления.
-- Применять в Supabase SQL Editor. Идемпотентно.
-- ================================================================

alter table public.faction_news add column if not exists staff_verdict text;
alter table public.faction_news add column if not exists staff_grants jsonb default '[]'::jsonb;
alter table public.faction_news add column if not exists verdict_by text;
alter table public.faction_news add column if not exists verdict_at timestamptz;
