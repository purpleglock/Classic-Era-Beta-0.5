-- ================================================================
-- DEV ROADMAP — планировщик задач и дедлайнов разработки
--
-- Профессиональный инструмент дорожной карты в админ-консоли
-- (admin.js, верхняя вкладка «🗺 Дорожная карта»). Три уровня:
--   1) Приёмная     — задача падает в общий пул на рассмотрение (status='pool')
--   2) Дорожная карта — авто-планировщик (WSJF + упаковка по календарю)
--                       строит порядок срочности и проектные сроки вперёд
--   3) Рассмотрение  — триаж пула: отказ (rejected) или включение (planned)
--
-- Сам алгоритм планирования живёт на КЛИЕНТЕ (admin.js, adRmSchedule):
-- пересчёт мгновенный и наглядный, как в Linear/Jira. База лишь хранит
-- канонические поля задач. CRUD идёт напрямую REST'ом — RLS пускает стафф.
--
-- Применять в Supabase → SQL Editor. Идемпотентно (перезапускаемо).
-- ================================================================

-- ── Таблица задач ───────────────────────────────────────────────
create table if not exists public.dev_tasks (
  id            bigint generated always as identity primary key,
  code          text unique,                         -- человекочитаемый ключ T-001 (авто)
  title         text not null,
  body          text default '',                     -- описание / критерии готовности
  status        text not null default 'pool',        -- pool | planned | active | done | rejected
  priority      int  not null default 2,             -- 1 низкий · 2 средний · 3 высокий · 4 критичный
  value         int  not null default 5,             -- бизнес-ценность 1..10 (для WSJF)
  effort_h      numeric not null default 8,          -- оценка трудозатрат, часов
  progress      int default 0,                       -- 0..100
  deadline      date,                                -- жёсткий срок (необязателен)
  depends_on    bigint[] default '{}',               -- id задач-предшественников
  tags          text[]  default '{}',
  assignee      text,
  color         text,                                -- цвет полосы на Ганте (необязателен)
  reject_reason text,
  rank          double precision default 0,          -- ручной нудж порядка (опционально)
  created_by    uuid default auth.uid(),
  created_email text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  planned_at    timestamptz,                          -- момент включения в карту
  started_at    timestamptz,
  done_at       timestamptz
);
create index if not exists dev_tasks_status_idx   on public.dev_tasks (status);
create index if not exists dev_tasks_deadline_idx on public.dev_tasks (deadline);
create index if not exists dev_tasks_created_idx  on public.dev_tasks (created_at desc);

-- направление/тип/сложность работ — основа авто-оценки трудозатрат (см. admin.js adRmEstimate)
alter table public.dev_tasks add column if not exists area        text;          -- подсистема проекта (economy/market/spy/…) или 'manual'
alter table public.dev_tasks add column if not exists work_type   text;          -- balance/bugfix/mirror/ui/slice/feature/…
alter table public.dev_tasks add column if not exists complexity  text;          -- s/m/l/xl
alter table public.dev_tasks add column if not exists effort_auto boolean default true; -- оценка посчитана автоматически (false = введена вручную)
alter table public.dev_tasks add column if not exists images        jsonb default '[]'::jsonb; -- картинки задачи (сжатые webp data-URL, стафф-инструмент)
alter table public.dev_tasks add column if not exists testing_until timestamptz;        -- статус 'testing' держится до этой даты, затем авто→done (7 дней)

-- докатка колонок, если таблица уже была создана ранней версией среза
alter table public.dev_tasks add column if not exists progress      int default 0;
alter table public.dev_tasks add column if not exists tags          text[] default '{}';
alter table public.dev_tasks add column if not exists color         text;
alter table public.dev_tasks add column if not exists rank          double precision default 0;
alter table public.dev_tasks add column if not exists created_email text;
alter table public.dev_tasks add column if not exists planned_at    timestamptz;
alter table public.dev_tasks add column if not exists started_at    timestamptz;
alter table public.dev_tasks add column if not exists done_at       timestamptz;

-- ── Авто-код T-001 (последовательность + триггер) ───────────────
create sequence if not exists public.dev_tasks_code_seq;
-- синхронизируем счётчик с уже существующими кодами (если докатываем)
do $$
declare m bigint;
begin
  select coalesce(max((regexp_replace(code,'\D','','g'))::bigint),0) into m
    from public.dev_tasks where code ~ '^T-\d+$';
  if m > 0 then perform setval('public.dev_tasks_code_seq', m); end if;
end$$;

create or replace function public._dev_task_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'T-' || lpad(nextval('public.dev_tasks_code_seq')::text, 3, '0');
  end if;
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_dev_task_code on public.dev_tasks;
create trigger trg_dev_task_code before insert on public.dev_tasks
  for each row execute function public._dev_task_code();

-- ── updated_at на апдейте ───────────────────────────────────────
create or replace function public._dev_task_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end$$;

drop trigger if exists trg_dev_task_touch on public.dev_tasks;
create trigger trg_dev_task_touch before update on public.dev_tasks
  for each row execute function public._dev_task_touch();

-- ── RLS: только стафф (superadmin/editor) ───────────────────────
alter table public.dev_tasks enable row level security;
drop policy if exists "dt_sel" on public.dev_tasks;
drop policy if exists "dt_ins" on public.dev_tasks;
drop policy if exists "dt_upd" on public.dev_tasks;
drop policy if exists "dt_del" on public.dev_tasks;
create policy "dt_sel" on public.dev_tasks for select to authenticated
  using (public.current_user_role() in ('superadmin','editor'));
create policy "dt_ins" on public.dev_tasks for insert to authenticated
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "dt_upd" on public.dev_tasks for update to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
create policy "dt_del" on public.dev_tasks for delete to authenticated
  using (public.current_user_role() in ('superadmin','editor'));

-- ── Конфиг планировщика (одна строка, id=1) ─────────────────────
create table if not exists public.dev_roadmap_config (
  id            int primary key default 1,
  capacity_h    numeric default 6,      -- продуктивных часов в рабочий день
  skip_weekends boolean default true,   -- пропускать сб/вс при раскладке
  w_value       numeric default 1.0,    -- вес бизнес-ценности в Cost of Delay
  w_priority    numeric default 1.0,    -- вес приоритета
  w_urgency     numeric default 2.0,    -- вес срочности по дедлайну
  w_age         numeric default 0.5,    -- вес «возраста» задачи в пуле/карте
  start_date    date,                   -- старт планирования (null = сегодня)
  updated_at    timestamptz default now(),
  constraint dev_roadmap_config_singleton check (id = 1)
);
insert into public.dev_roadmap_config (id) values (1) on conflict (id) do nothing;

alter table public.dev_roadmap_config enable row level security;
drop policy if exists "drc_sel" on public.dev_roadmap_config;
drop policy if exists "drc_upd" on public.dev_roadmap_config;
create policy "drc_sel" on public.dev_roadmap_config for select to authenticated
  using (public.current_user_role() in ('superadmin','editor'));
create policy "drc_upd" on public.dev_roadmap_config for update to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Готово. Проверка: select * from public.dev_tasks; ───────────
do $$ begin raise notice 'dev_roadmap: dev_tasks + dev_roadmap_config готовы (RLS staff only)'; end $$;
