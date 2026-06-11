-- ============================================================
-- ЭТАП 2e — АНКЕТЫ ФРАКЦИЙ: запрет самоодобрения в обход модерации
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыра: политика fa_update разрешает владельцу PATCH'ить свою анкету с ЛЮБЫМИ
--   полями. Из консоли:
--     dbPatch('faction_applications','id=eq.'+myId,{status:'approved',faction_id:'x'})
--   → самоодобрение фракции в обход стаффа (+ потом economy_init даёт казну/столицу).
--
-- Фикс: триггер. Обычный игрок может ставить статус только 'draft'/'pending'
--   и не может трогать faction_id/reviewed_by. Одобрение/отклонение — только
--   стафф или SECURITY DEFINER approve_faction_application (он current_user=postgres).
-- bonus_money НЕ трогаем — это легальный выбор игрока в анкете (faction_reg.js).
-- ============================================================

create or replace function public._guard_faction_app()
returns trigger
language plpgsql
security invoker                      -- ВАЖНО: invoker (см. остальные гарды)
set search_path = public
as $$
begin
  -- RPC одобрения (definer, current_user=postgres) и стафф — без ограничений.
  if current_user <> 'authenticated'
     or public.current_user_role() in ('superadmin','editor','moderator') then
    return NEW;
  end if;

  -- Обычный игрок: статус только черновик/на-модерации.
  if NEW.status is distinct from 'draft' and NEW.status is distinct from 'pending' then
    raise exception 'forbidden: only staff can approve/reject applications'
      using errcode = 'check_violation';
  end if;

  -- faction_id и reviewed_by проставляет только сервер при одобрении.
  if TG_OP = 'INSERT' then
    if NEW.faction_id is not null then
      raise exception 'forbidden: faction_id is server-assigned' using errcode = 'check_violation';
    end if;
  else
    if NEW.faction_id is distinct from OLD.faction_id then
      raise exception 'forbidden: faction_id is server-assigned' using errcode = 'check_violation';
    end if;
    if NEW.reviewed_by is distinct from OLD.reviewed_by then
      raise exception 'forbidden: reviewed_by is staff-only' using errcode = 'check_violation';
    end if;
  end if;

  return NEW;
end$$;

drop trigger if exists trg_guard_faction_app on public.faction_applications;
create trigger trg_guard_faction_app
  before insert or update on public.faction_applications
  for each row execute function public._guard_faction_app();

-- RLS-страховка (триггер работает и без неё, но пусть будет включена).
alter table public.faction_applications enable row level security;

-- ── Проверка ────────────────────────────────────────────────
-- Под игроком в консоли должно падать с 'forbidden':
--   dbPatch('faction_applications','id=eq.'+FR.data.id,{status:'approved'})
-- Сохранение черновика / подача на модерацию — работают как раньше.
