-- ═══════════════════════════════════════════════════════════════════════
--  Машинный перевод игрового текста: общий кэш переводов.
--  Ключ — хэш исходного текста + язык назначения. Кэш общий на всех:
--  реплику, переведённую одному игроку, остальные получают даром.
--  Пишет и читает ТОЛЬКО edge-функция translate (service role).
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.mt_cache (
  h          text primary key,            -- sha256(src_lang|dst_lang|text)
  src        text not null,               -- язык оригинала (ru/en/…)
  dst        text not null,               -- язык перевода
  body       text not null,               -- оригинал (для отладки/ревизии)
  tr         text not null,               -- перевод
  hits       integer not null default 1,
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now()
);

create index if not exists mt_cache_seen_idx on public.mt_cache (seen_at);

alter table public.mt_cache enable row level security;
-- Политик нет намеренно: анон/авторизованный клиент к таблице не ходит,
-- всё общение — через edge-функцию с service role (RLS её не касается).

-- Чистка: строки, которых не спрашивали 90 дней, не нужны.
create or replace function public.mt_cache_gc()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.mt_cache where seen_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
