-- ═══ Две причины пропажи кораблей/флотов ═══════════════════════════════════
-- 1) RLS активов знала только `owner_id = auth.uid()`. Ни служащий из состава
--    державы, ни НОВЫЙ владелец после передачи строк не видел — ростер пуст.
-- 2) Аннексия и уния перевешивают faction_id, но owner_id оставляют на
--    владельце младшей державы, так что дрейф возникал снова.
-- Разовую пересинхронизацию сделал _owner_resync.sql; здесь — постоянная.

-- ── 1. Владелец строки подтягивается за faction_id ─────────────────────────
-- Правда о владельце — approved-анкета. Триггер вешаем на UPDATE OF faction_id,
-- поэтому в обычной жизни таблиц он не срабатывает вовсе (диск бережём, см.
-- отключённые аудит-триггеры) — только когда актив меняет державу.
create or replace function public._own_follow_fid()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_owner uuid;
begin
  if new.faction_id is distinct from old.faction_id then
    select owner_id into v_owner from public.faction_applications
      where faction_id = new.faction_id and status = 'approved' and owner_id is not null
      order by updated_at desc limit 1;
    if v_owner is not null then new.owner_id := v_owner; end if;
  end if;
  return new;
end$$;

do $$
declare t text; n int := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='faction_id'
      and c.data_type in ('text','character varying')
      and exists (select 1 from information_schema.columns c2
                   where c2.table_schema='public' and c2.table_name=c.table_name
                     and c2.column_name='owner_id' and c2.data_type='uuid')
      -- анкета сама и есть источник правды; членство живёт своей жизнью
      and c.table_name not in ('faction_applications','faction_members','faction_deletions')
  loop
    execute format('drop trigger if exists trg_own_follow_fid on public.%I', t);
    execute format('create trigger trg_own_follow_fid before update of faction_id on public.%I
                    for each row execute function public._own_follow_fid()', t);
    n := n + 1;
  end loop;
  raise notice 'триггеров навешено: %', n;
end $$;

-- ── 2. RLS: свою державу видит вся её служба ───────────────────────────────
-- `_ec_my_fid_opt()` = владелец approved-анкеты ИЛИ активный участник состава
-- (_fm_own_fid → _fm_member_fid). Тот же приём уже стоит на faction_turrets,
-- faction_reactors и faction_armor_alloys — распространяем на остальные активы.
do $$
declare r record; q text;
begin
  for r in
    select p.tablename, p.policyname, p.qual::text as qual
      from pg_policies p
     where p.schemaname='public' and p.cmd='SELECT'
       and p.qual::text like '%owner_id = auth.uid()%'
       and p.qual::text not like '%_ec_my_fid_opt()%'
       and p.tablename in (
         'armies','colony_projects','econ_logistics','econ_relief','faction_economy',
         'faction_units','fleets','galactic_ledger','income_history','outpost_ships',
         'outposts','spy_agents','spy_recruits','system_drone_posts','system_minefields',
         'unit_production')
  loop
    q := format('alter policy %I on public.%I using ((%s) or (faction_id = public._ec_my_fid_opt()))',
                r.policyname, r.tablename, r.qual);
    execute q;
    raise notice 'политика % на % расширена', r.policyname, r.tablename;
  end loop;
end $$;

-- Достижения читались через faction_economy.owner_id — та же слепота у службы.
alter policy fa_select_own on public.faction_achievements using (
  exists (select 1 from public.faction_economy fe
           where fe.faction_id = faction_achievements.faction_id
             and fe.owner_id = auth.uid())
  or faction_id = public._ec_my_fid_opt()
);
