-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА, ЭТАП 0 — ЧИСТКА СТАРОГО ФОРМАТА (18.10.2026)
-- ------------------------------------------------------------
-- Решение владельца: старые наземные проекты и построенные наземные юниты
-- списываются, державам возвращается 50% нынешней цены проекта в ГС.
--   • юниты без проекта (проект уже удалён) — возврат 0;
--   • армии распускаются: наземка списывается с возвратом, авиация (она
--     заморожена, но не удаляется) возвращается на склад как готовые юниты;
--   • всё удаляемое сначала копируется в схему backup_ground_20261018 —
--     откатить можно из неё;
--   • серверная заморозка: заказать наземку или авиацию нельзя даже в обход
--     клиента, пока не снят флаг _ground_frozen().
-- Файл одноразовый: второй прогон ничего не вернёт повторно (возврат
-- считается по ещё не удалённым строкам).
-- ════════════════════════════════════════════════════════════

-- ── 1. Резервные копии ───────────────────────────────────────
create schema if not exists backup_ground_20261018;
create table if not exists backup_ground_20261018.unit_production as
  select * from public.unit_production where category = 'ground';
create table if not exists backup_ground_20261018.armies as
  select * from public.armies;
create table if not exists backup_ground_20261018.faction_units as
  select * from public.faction_units where category = 'ground';
create table if not exists backup_ground_20261018.faction_economy_gc as
  select faction_id, gc from public.faction_economy;

-- ── 2. Возврат 50% ───────────────────────────────────────────
create table if not exists backup_ground_20261018.refunds (faction_id text primary key, units bigint, gc numeric);

with built as (
  select p.faction_id fid, p.unit_id, p.qty::bigint qty
    from public.unit_production p where p.category = 'ground' and p.status = 'done'
  union all
  select a.faction_id, nullif(c->>'unit_id','')::uuid, greatest(0, coalesce((c->>'qty')::int,0))
    from public.armies a, jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c
   where coalesce(nullif(c->>'category',''),'ground') = 'ground'
), sums as (
  select b.fid, sum(b.qty) units,
         round(sum(b.qty * coalesce((u.summary->>'cost')::numeric, 0)) * 0.5) gc
    from built b left join public.faction_units u on u.id = b.unit_id
   where b.fid is not null
   group by b.fid
)
insert into backup_ground_20261018.refunds(faction_id, units, gc)
  select fid, units, gc from sums
on conflict (faction_id) do nothing;

update public.faction_economy e set gc = coalesce(e.gc,0) + r.gc
  from backup_ground_20261018.refunds r
 where e.faction_id = r.faction_id and r.gc > 0;

-- ── 3. Армии: авиацию на склад, затем распустить ────────────
insert into public.unit_production(faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at)
  select a.faction_id, a.owner_id, nullif(c->>'unit_id','')::uuid, c->>'unit_name', 'aviation', 'airfield',
         greatest(0, coalesce((c->>'qty')::int,0)), 'done', now()
    from public.armies a, jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c
   where c->>'category' = 'aviation' and coalesce((c->>'qty')::int,0) > 0;
delete from public.armies;

-- ── 4. Наземные юниты и проекты ─────────────────────────────
delete from public.unit_production where category = 'ground';
delete from public.bt_bot_exclude where unit_id in (select id from public.faction_units where category = 'ground');
delete from public.faction_units where category = 'ground';

-- ── 5. Сводка державам ──────────────────────────────────────
select public._war_news(
  '🛠 Расформирование наземных войск',
  format('Наземные войска державы %s расформированы до выхода новой наземной войны: списано %s ед. техники и пехоты, казна получила %s ГС (половина стоимости по прайсу проектов). Авиация из армий вернулась на склад.',
         public._war_nm(r.faction_id), r.units, r.gc),
  jsonb_build_array(r.faction_id))
from backup_ground_20261018.refunds r;

-- ── 6. Серверная заморозка производства наземки и авиации ───
create or replace function public._ground_frozen() returns boolean
language sql immutable as $$ select true $$;   -- снять: вернуть false

create or replace function public._ground_freeze_gate() returns trigger
language plpgsql as $$
begin
  if public._ground_frozen() then
    raise exception 'производство наземки и авиации приостановлено до выхода наземной войны';
  end if;
  return new;
end $$;

drop trigger if exists trg_ground_freeze on public.unit_production;
create trigger trg_ground_freeze before insert on public.unit_production
  for each row when (new.status = 'queued' and new.category in ('ground','aviation'))
  execute function public._ground_freeze_gate();
