-- ════════════════════════════════════════════════════════════════════════
-- LEGAL CONSENT — фиксация согласия игроков с Политикой конфиденциальности
-- и Пользовательским соглашением (ФЗ-152 / GDPR).
--
-- Документы отдаются статикой из /legal/*.md и рендерятся на клиенте.
-- Здесь хранится только ФАКТ согласия: кто, когда, какие документы и какой
-- их версии принял. Это и есть подтверждение акцепта оферты.
--
-- Применять один раз в Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Таблица записей о согласии ------------------------------------------
create table if not exists public.legal_consents (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  email       text,
  doc_slug    text        not null,          -- 'privacy' | 'terms'
  doc_version text        not null,          -- напр. '2026-06-30'
  accepted_at timestamptz not null default now(),
  user_agent  text,
  unique (user_id, doc_slug, doc_version)
);

create index if not exists idx_legal_consents_user on public.legal_consents(user_id);

comment on table public.legal_consents is
  'Журнал согласий пользователей с правовыми документами (ФЗ-152/GDPR). Доказательство акцепта.';

-- 2. RLS: пользователь видит только свои согласия ------------------------
alter table public.legal_consents enable row level security;

drop policy if exists legal_consents_select_own on public.legal_consents;
create policy legal_consents_select_own on public.legal_consents
  for select using (auth.uid() = user_id);

-- Прямую вставку/изменение клиентом запрещаем — только через RPC ниже.
-- (никаких insert/update/delete policy => клиент писать напрямую не может)

-- 3. RPC фиксации согласия (SECURITY DEFINER) ----------------------------
-- Клиент вызывает legal_accept('[{"slug":"privacy","version":"2026-06-30"},
--                               {"slug":"terms","version":"2026-06-30"}]')
create or replace function public.legal_accept(p_docs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_rec   jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;

  for v_rec in select * from jsonb_array_elements(p_docs)
  loop
    insert into public.legal_consents (user_id, email, doc_slug, doc_version)
    values (
      v_uid,
      v_email,
      v_rec->>'slug',
      v_rec->>'version'
    )
    on conflict (user_id, doc_slug, doc_version) do nothing;
  end loop;
end;
$$;

revoke all on function public.legal_accept(jsonb) from public;
grant execute on function public.legal_accept(jsonb) to authenticated;

-- 4. Удобное представление: принял ли пользователь актуальные версии -----
-- (необязательно; помогает в админке смотреть статус согласий)
create or replace function public.legal_has_accepted(p_slug text, p_version text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.legal_consents
    where user_id = auth.uid()
      and doc_slug = p_slug
      and doc_version = p_version
  );
$$;

revoke all on function public.legal_has_accepted(text, text) from public;
grant execute on function public.legal_has_accepted(text, text) to authenticated;
