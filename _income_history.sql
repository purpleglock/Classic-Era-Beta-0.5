-- ============================================================
-- ИСТОРИЯ ДОХОДА — снимок казны на каждом тике (для таблицы «доход по времени»)
-- Применять в Supabase → SQL Editor. Идемпотентно. economy_accrue НЕ трогаем —
-- ловим момент тика триггером (last_tick сдвигается только при начислении).
-- ============================================================

create table if not exists public.income_history (
  id        uuid primary key default gen_random_uuid(),
  faction_id text not null,
  owner_id  uuid,
  gc_after  numeric, gc_delta numeric,     -- казна после тика и чистый прирост ГС
  sci_after numeric, sci_delta numeric,    -- наука после и прирост
  tick_at   timestamptz default now()
);
create index if not exists ih_fac_idx on public.income_history(faction_id, tick_at desc);

alter table public.income_history enable row level security;
drop policy if exists "ih_sel" on public.income_history;
create policy "ih_sel" on public.income_history for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- Триггер: тик произошёл (last_tick сдвинулся) → пишем снимок прироста
create or replace function public._log_income()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.last_tick is distinct from OLD.last_tick then
    insert into public.income_history(faction_id, owner_id, gc_after, gc_delta, sci_after, sci_delta)
      values(NEW.faction_id, NEW.owner_id, NEW.gc, NEW.gc - OLD.gc, NEW.science, NEW.science - OLD.science);
    -- держим не более 30 последних снимков на фракцию
    delete from public.income_history
      where faction_id = NEW.faction_id
        and id not in (select id from public.income_history where faction_id=NEW.faction_id order by tick_at desc limit 30);
  end if;
  return NEW;
end$$;

drop trigger if exists trg_income_log on public.faction_economy;
create trigger trg_income_log after update on public.faction_economy
  for each row execute function public._log_income();

-- ── Проверка ────────────────────────────────────────────────
-- После следующего тика: select * from public.income_history order by tick_at desc;
