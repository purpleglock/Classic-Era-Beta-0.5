-- ============================================================
-- ЭТАП 2c — ЗАМОК: запрет ПРЯМОЙ записи игрока в эконом-таблицы
-- Применять ПОСЛЕДНИМ, когда клиент уже переведён на RPC (_security_money.sql
-- применён, economy.js/constructors.js задеплоены и проверены чек-листом).
--
-- ПОСЛЕ ЭТОГО консольные читы умирают:
--   dbPatch('faction_economy', ..., {science: +1000000})  → forbidden
--   dbPost ('colony_projects', ...)                       → forbidden
--   dbPatch('colonies'/'colony_buildings'/'unit_production', ...) → forbidden
--
-- Кто ПРОХОДИТ замок:
--   • серверные SECURITY DEFINER RPC (economy_build/colonize/produce/tick/accrue/…)
--     — внутри них current_user = владелец функции (postgres), а не 'authenticated';
--   • стафф (superadmin/editor/moderator) — для работы админки (admin.js).
-- Кто НЕ проходит: обычный игрок прямым REST-запросом из браузера/консоли.
--
-- ⚠ Триггер-функция SECURITY INVOKER — иначе current_user всегда = владелец и
--   проверка отключится (см. тот же приём в _security_stopgap.sql).
-- Идемпотентно.
-- ============================================================

create or replace function public._guard_economy_write()
returns trigger
language plpgsql
security invoker                     -- ВАЖНО: invoker, не definer
set search_path = public
as $$
begin
  -- Внутри серверных RPC и планировщика роль НЕ 'authenticated' → доверяем.
  -- Стафф правит вручную из админки → тоже пропускаем.
  if current_user <> 'authenticated'
     or public.current_user_role() in ('superadmin','editor','moderator') then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  -- Обычный игрок прямой записью — запрет. Легальные действия идут через RPC.
  raise exception 'forbidden: % is server-managed — use in-game actions, not direct writes', TG_TABLE_NAME
    using errcode = 'check_violation';
end$$;

-- Старые точечные стопгап-триггеры больше не нужны: новый гард строже (он же
-- покрывает мгновенную достройку — игрок вообще не может писать эти таблицы).
drop trigger if exists trg_guard_colony_projects on public.colony_projects;
drop trigger if exists trg_guard_unit_production  on public.unit_production;

-- Навешиваем замок на все 5 таблиц.
do $$
declare t text;
begin
  foreach t in array array[
    'faction_economy','colonies','colony_buildings','colony_projects','unit_production'
  ] loop
    execute format('drop trigger if exists trg_lock_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_lock_%1$s before insert or update or delete on public.%1$s '
      || 'for each row execute function public._guard_economy_write()', t);
  end loop;
end$$;

-- RLS-страховка (на случай, если где-то была выключена): включаем, НЕ форсируем
-- (force заставил бы и SECURITY DEFINER-функции подчиняться политикам → риск).
alter table public.faction_economy  enable row level security;
alter table public.colonies         enable row level security;
alter table public.colony_buildings enable row level security;
alter table public.colony_projects  enable row level security;
alter table public.unit_production   enable row level security;

-- ── Проверка после применения ───────────────────────────────
-- Под ОБЫЧНЫМ игроком (не стафф) в консоли должно падать с 'forbidden':
--   dbPatch('faction_economy','faction_id=eq.'+EC.fid,{science:(EC.eco.science||0)+1000000})
-- А постройка/колонизация/производство через кабинет — работают как обычно
-- (идут через RPC). Под стаффом админка тоже работает.
