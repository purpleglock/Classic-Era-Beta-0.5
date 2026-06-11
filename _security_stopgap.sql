-- ============================================================
-- ЭТАП 1 — СТОПГАП БЕЗОПАСНОСТИ (применить в Supabase → SQL Editor)
-- ============================================================
-- Закрывает МГНОВЕННУЮ ДОСТРОЙКУ проектов/производства через консоль:
--   dbPatch('colony_projects', ..., {ready_at: now+30s})   ← убито
--   dbPost('unit_production',  ..., {ready_at: прошлое})    ← убито
--
-- ИДЕЯ: легальный клиент НИКОГДА не делает UPDATE этих таблиц (только INSERT/DELETE),
-- а готовность/статус проставляет СЕРВЕР внутри SECURITY DEFINER функций
-- (economy_accrue, _apply_colony_projects). Поэтому:
--   • любой UPDATE от роли authenticated — читерский → запрещаем;
--   • на INSERT ready_at нельзя поставить «вот-вот» → запрещаем мгновенную готовность.
--
-- ⚠ Триггер-функция SECURITY INVOKER (НЕ definer!) — только так current_user внутри
--   триггера равен реальной роли запроса: 'authenticated' для прямого PATCH из
--   браузера и владелец-функции (postgres) при вызове из серверных RPC. Не меняй на
--   SECURITY DEFINER — иначе current_user всегда = владелец и проверка отключится.
--
-- ⚠ НЕ закрывает «бесконечные деньги/науку» (faction_economy) — это связанная
--   задача (покупки+возвраты+revoke), идёт ЭТАПОМ 2. Здесь — только таймеры.
-- Идемпотентно: можно гонять повторно.
-- ============================================================

-- RLS-страховка: триггер работает и без RLS, но пусть RLS будет включён.
alter table public.colony_projects enable row level security;
alter table public.unit_production  enable row level security;

-- ── Гард таймеров ───────────────────────────────────────────
create or replace function public._guard_timed_row()
returns trigger
language plpgsql
security invoker                      -- ВАЖНО: invoker, не definer (см. шапку)
set search_path = public
as $$
declare min_ready timestamptz;
begin
  -- Внутри серверных SECURITY DEFINER функций current_user = владелец (postgres),
  -- а не 'authenticated' → доверяем (начисление/применение проектов/планировщик).
  if current_user <> 'authenticated' then
    return NEW;
  end if;

  -- Стафф правит вручную из админки — разрешаем любые правки.
  if public.current_user_role() in ('superadmin','editor','moderator') then
    return NEW;
  end if;

  -- Обычный игрок:
  -- 1) UPDATE этих таблиц у клиента не бывает легально → блок (это и есть эксплойт ready_at).
  if TG_OP = 'UPDATE' then
    raise exception 'forbidden: % is server-managed, no client UPDATE', TG_TABLE_NAME
      using errcode = 'check_violation';
  end if;

  -- 2) INSERT: запрет «почти готового» проекта (мгновенная достройка).
  if TG_TABLE_NAME = 'colony_projects' then
    -- клиент всегда ставит ≥ 1 игровой день (24 ч); 20 ч — допуск на расхождение часов
    min_ready := now() + interval '20 hours';
  else
    -- unit_production: клиент ставит ready_at = last_tick + 24 ч
    select coalesce(last_tick, now()) + interval '20 hours'
      into min_ready
      from public.faction_economy
      where faction_id = NEW.faction_id;
    if min_ready is null then
      min_ready := now() + interval '20 hours';
    end if;
  end if;

  if NEW.ready_at is null or NEW.ready_at < min_ready then
    raise exception 'forbidden: ready_at too soon — instant-complete blocked'
      using errcode = 'check_violation';
  end if;

  return NEW;
end$$;

-- ── Навешиваем на обе таблицы ───────────────────────────────
drop trigger if exists trg_guard_colony_projects on public.colony_projects;
create trigger trg_guard_colony_projects
  before insert or update on public.colony_projects
  for each row execute function public._guard_timed_row();

drop trigger if exists trg_guard_unit_production on public.unit_production;
create trigger trg_guard_unit_production
  before insert or update on public.unit_production
  for each row execute function public._guard_timed_row();

-- ── Проверка после применения (опционально) ─────────────────
-- В консоли НЕ-стаффом эти строки должны теперь падать с 'forbidden':
--   dbPatch('colony_projects','faction_id=eq.<свой>',{ready_at:new Date().toISOString()})
--   dbPost ('unit_production',{... ready_at: прошлое ...})
-- Легальная постройка/производство (через кабинет) — работают как раньше.
