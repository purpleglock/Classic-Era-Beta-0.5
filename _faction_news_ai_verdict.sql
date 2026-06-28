-- ================================================================
-- FACTION NEWS — ИИ-вердикт (нейро-оценка новостей игроков)
--
-- Нейросеть (OpenRouter Qwen :free, через Edge Function `news-verdict`)
-- оценивает новость на соответствие лору фракции, связность с прошлыми
-- событиями и актуальность. Результат — структурированный JSON в ai_verdict.
-- Читается в статье тем же блоком, что и вердикт администрации.
--
-- Финальная метка (approve/review/reject) считается НА СЕРВЕРЕ из числовых
-- оценок — самой модели метка не доверяется (защита от промпт-инъекций).
--
-- Применять в Supabase SQL Editor. Идемпотентно.
-- ================================================================

-- Структура ai_verdict (jsonb):
--   { "verdict": "approve|review|reject",
--     "lore": 0..100,          -- соответствие лору фракции
--     "continuity": 0..100,    -- связность с прошлыми событиями
--     "relevance": 0..100,     -- актуальность/осмысленность
--     "injection": true|false, -- замечена попытка манипуляции
--     "reason": "1-2 фразы для читателя/админа",
--     "refs": ["news:<id>", "lore:history", ...], -- на что опиралась
--     "model": "qwen/...",
--     "ok": true|false }       -- удалось ли распарсить корректный ответ
alter table public.faction_news add column if not exists ai_verdict   jsonb;
alter table public.faction_news add column if not exists ai_status    text default 'none';  -- none|pending|done|error
alter table public.faction_news add column if not exists ai_verdict_at timestamptz;

create index if not exists fn_ai_status_idx on public.faction_news(ai_status);

-- Записывать ai_verdict может ТОЛЬКО сервер (service_role обходит RLS).
-- Игроку колонки доступны лишь на чтение; явный revoke на UPDATE этих
-- столбцов делает невозможной подмену вердикта через клиентскую консоль
-- (см. заметку client-write-rls-hole).
revoke update (ai_verdict, ai_status, ai_verdict_at) on public.faction_news from anon, authenticated;
