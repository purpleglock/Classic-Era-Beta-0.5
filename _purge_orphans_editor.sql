-- ============================================================
-- ТОТАЛЬНАЯ ДОЧИСТКА ОСИРОТЕВШИХ ФРАКЦИЙ — ПРЯМО В SQL EDITOR.
-- v3: ДИНАМИЧЕСКИЙ проход по ВСЕМ таблицам схемы public, где есть
-- колонка-ссылка на фракцию. Сносит строки фракций, которых больше
-- нет ни в анкетах (faction_applications), ни на карте (map_factions):
-- флоты, аванпосты, мины, залпы, носители, веру, дипломатию, биржу,
-- шпионаж, дотации и т.д. От удалённой фракции не остаётся НИЧЕГО.
--
-- Без проверки роли (редактор = postgres). FK-проверки на время
-- сессии отключены (session_replication_role=replica), чтобы порядок
-- удаления не ломал внешние ключи. Идемпотентно. Выполни ВЕСЬ файл.
-- ============================================================
do $$
declare
  -- имена колонок, которыми таблицы ссылаются на фракцию-владельца/участника
  fid_cols text[] := array[
    'faction_id','fid','owner_fid','host_fid','founder_fid','actor_fid',
    'target_fid','lender_fid','borrower_fid','a_fid','b_fid','from_fid',
    'to_fid','issuer_fid','holder_fid','seller_fid','buyer_fid','leader_fid',
    'member_fid','lord_fid','vassal_fid','raider_fid'
  ];
  -- НЕ трогаем: реестр анкет (источник истины) и аудиторские журналы
  skip_tables text[] := array[
    'faction_applications','faction_deletions','faction_audit'
  ];
  rec record;
  n   bigint;
  total bigint := 0;
begin
  set session_replication_role = replica;   -- отключить FK-проверки на сессию

  for rec in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = 'public' and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name = any(fid_cols)
      and c.table_name <> all(skip_tables)
    order by c.table_name, c.column_name
  loop
    execute format(
      'delete from public.%I t
         where t.%I is not null
           and not exists (select 1 from public.faction_applications a where a.faction_id = t.%I)
           and not exists (select 1 from public.map_factions m        where m.id        = t.%I)',
      rec.table_name, rec.column_name, rec.column_name, rec.column_name);
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '  % (%): вычищено %', rec.table_name, rec.column_name, n;
      total := total + n;
    end if;
  end loop;

  -- Карта: обнулить владельца у систем осиротевших фракций
  update public.map_systems ms
    set faction = null
    where ms.faction is not null
      and not exists (select 1 from public.map_factions m where m.id = ms.faction);
  get diagnostics n = row_count;
  if n > 0 then raise notice '  map_systems.faction обнулено: %', n; end if;

  -- «Бедность»/беспорядки по системам без владельца
  if to_regclass('public.system_econ') is not null then
    delete from public.system_econ se
      where not exists (
        select 1 from public.map_systems ms
        where ms.id = se.system_id and ms.faction is not null);
    get diagnostics n = row_count;
    if n > 0 then raise notice '  system_econ очищено: %', n; end if;
  end if;

  set session_replication_role = default;   -- вернуть FK-проверки
  raise notice 'ИТОГО строк удалено по фракционным колонкам: %', total;
end$$;
