-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- 1) РАЗОВОЕ ЗАВЕРШЕНИЕ ВСЕХ ВОЙН И БОЁВ
-- 2) УДАЛЕНИЕ ФРАКЦИИ ТЕПЕРЬ УНОСИТ ЕЁ БОИ И ВОЙНЫ
-- ────────────────────────────────────────────────────────────
-- ЗАЧЕМ (2). Динамический реестр `_faction_ref_columns()` знал только
-- 'faction_id','fid','a_fid','b_fid' и т.п. — но `battles` и `wars`
-- ссылаются на державу колонками attacker_fid / defender_fid / winner_fid.
-- Их в списке не было: после сноса фракции её бои и войны оставались
-- висеть, блокируя чужие флоты и торча в «Мои бои» у противника.
-- Дети (battle_fleets, battle_units, war_sides, war_offers) уходят
-- каскадом по FK — достаточно снести родителя.
--
-- Идемпотентно. Порядок: после _delete_faction_cleanup.sql.
-- ════════════════════════════════════════════════════════════

begin;

-- ── §1. Закрыть все бои ──────────────────────────────────────
-- Флоты держит `_fleet_in_battle` по status <> 'done' — закрытие боя
-- их расковывает. Победителя не назначаем: бои прерваны, не выиграны.
update public.battles
   set status       = 'done',
       ended_at     = coalesce(ended_at, now()),
       side_to_move = null,
       att_ready    = false,
       def_ready    = false,
       deadline_at  = null
 where status <> 'done';

-- ── §2. Закрыть все войны ────────────────────────────────────
-- 'status_quo' — единственный исход без победителя из wars_status_ck.
update public.wars
   set status       = 'status_quo',
       ended_at     = coalesce(ended_at, now()),
       outcome_note = coalesce(nullif(outcome_note,''),
                               'Все фронты заморожены разовым сбросом.')
 where status = 'active';

-- ── §3. Реестр фракц-колонок: добавлены стороны боёв и войн ──
create or replace function public._faction_ref_columns()
returns table(tbl text, col text)
language sql stable security definer set search_path = public
as $$
  select c.table_name::text, c.column_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = 'public' and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.column_name in (
      'faction_id','fid','owner_fid','host_fid','founder_fid','actor_fid',
      'target_fid','lender_fid','borrower_fid','a_fid','b_fid','from_fid',
      'to_fid','issuer_fid','holder_fid','seller_fid','buyer_fid','leader_fid',
      'member_fid','lord_fid','vassal_fid','raider_fid',
      -- бои и войны: стороны и победитель
      'attacker_fid','defender_fid','winner_fid'
    )
    and c.table_name not in ('faction_applications','faction_deletions','faction_audit')
$$;
revoke all on function public._faction_ref_columns() from public;

-- ── §4. Дочистка: бои и войны уже удалённых фракций ──────────
-- 'bot' и 'club' — служебные стороны (админ-бой, арена), их не проверяем.
delete from public.battles b
 where (b.attacker_fid not in ('bot','club')
        and not exists (select 1 from public.faction_applications a where a.faction_id = b.attacker_fid)
        and not exists (select 1 from public.map_factions m         where m.id         = b.attacker_fid))
    or (b.defender_fid not in ('bot','club')
        and not exists (select 1 from public.faction_applications a where a.faction_id = b.defender_fid)
        and not exists (select 1 from public.map_factions m         where m.id         = b.defender_fid));

delete from public.wars w
 where (not exists (select 1 from public.faction_applications a where a.faction_id = w.attacker_fid)
        and not exists (select 1 from public.map_factions m     where m.id         = w.attacker_fid))
    or (not exists (select 1 from public.faction_applications a where a.faction_id = w.defender_fid)
        and not exists (select 1 from public.map_factions m     where m.id         = w.defender_fid));

commit;

-- Проверка:
--   select count(*) from battles where status <> 'done';  → 0
--   select count(*) from wars    where status =  'active'; → 0
