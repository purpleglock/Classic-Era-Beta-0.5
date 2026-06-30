-- ============================================================
-- ТОТАЛЬНОЕ УДАЛЕНИЕ ФРАКЦИИ + ДОЧИСТКА СИРОТ.
-- От удалённой фракции не должно оставаться НИЧЕГО: ни флотов,
-- ни аванпостов, ни мин, ни залпов/носителей артиллерии, ни паствы
-- веры, ни дипломатии/биржи/шпионажа, ни «бедности» на её бывших
-- системах.
--
-- Подход — ДИНАМИЧЕСКИЙ: один проход по ВСЕМ таблицам схемы public,
-- у которых есть колонка-ссылка на фракцию (faction_id, *_fid и т.п.).
-- Новые игровые таблицы покрываются автоматически, без правки этого
-- файла. Реестр анкет и аудиторские журналы не трогаем.
--
-- Что внутри:
--   1) _faction_ref_columns()      — список (таблица, колонка) фракц-ссылок
--   2) _faction_purge_tails(fid)   — снести все строки одной фракции
--   3) _system_econ_clear_orphans()— сбросить «бедность» пустых систем
--   4) admin_delete_faction(fid)   — полное удаление (RPC для админа/эдитора)
--   5) admin_purge_orphans()       — разовая дочистка УЖЕ удалённых фракций
--
-- Запустить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── 1) Реестр фракц-колонок ───────────────────────────────────
-- Возвращает все (таблица, колонка) в public, которыми строки
-- ссылаются на фракцию. Исключает источник истины (faction_applications)
-- и аудиторские журналы (faction_deletions, faction_audit).
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
      'member_fid','lord_fid','vassal_fid','raider_fid'
    )
    and c.table_name not in ('faction_applications','faction_deletions','faction_audit')
$$;
revoke all on function public._faction_ref_columns() from public;

-- ── 2) Снести все строки одной фракции (по всем фракц-колонкам) ──
-- Многопроходно (до 8 раз) с перехватом FK-нарушений: если родитель
-- удаляется раньше ребёнка — повтор на следующем проходе уберёт его.
create or replace function public._faction_purge_tails(p_faction_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare rec record; pass int; progressed boolean; n bigint;
begin
  for pass in 1..8 loop
    progressed := false;
    for rec in select tbl, col from public._faction_ref_columns() loop
      begin
        execute format('delete from public.%I where %I = $1', rec.tbl, rec.col)
          using p_faction_id;
        get diagnostics n = row_count;
        if n > 0 then progressed := true; end if;
      exception when foreign_key_violation then
        progressed := true;   -- ребёнок ещё держит — добьём следующим проходом
      end;
    end loop;
    exit when not progressed;
  end loop;

  -- Карта: обнулить владельца у систем фракции (на случай отсутствия FK SET NULL)
  if to_regclass('public.map_systems') is not null then
    update public.map_systems set faction = null where faction = p_faction_id;
  end if;
end$$;
revoke all on function public._faction_purge_tails(text) from public;

-- ── 3) Сброс «бедности» по системам без владельца ─────────────
create or replace function public._system_econ_clear_orphans()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int := 0;
begin
  if to_regclass('public.system_econ') is null then return 0; end if;
  if to_regclass('public.map_systems') is null then return 0; end if;
  delete from public.system_econ se
    where not exists (
      select 1 from public.map_systems ms
      where ms.id = se.system_id and ms.faction is not null);
  get diagnostics n = row_count;
  return n;
end$$;
revoke all on function public._system_econ_clear_orphans() from public;

-- ── 4) ПОЛНОЕ УДАЛЕНИЕ ФРАКЦИИ ────────────────────────────────
create or replace function public.admin_delete_faction(p_faction_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner_id uuid; v_owner_email text; v_name text;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  -- Данные владельца/имя до удаления анкеты
  select owner_id, owner_email, name into v_owner_id, v_owner_email, v_name
    from public.faction_applications
    where faction_id = p_faction_id
    limit 1;

  -- Аудит удаления (требует таблицы из _admin_users.sql) — пишем ДО сноса
  insert into public.faction_deletions (faction_id, faction_name, owner_id, owner_email, deleted_by)
    values (p_faction_id, coalesce(v_name, p_faction_id), v_owner_id, v_owner_email, auth.jwt() ->> 'email');

  -- Снос всех игровых данных фракции по всем фракц-колонкам (динамически):
  -- экономика, постройки, колонии, юниты, флоты, аванпосты, мины, залпы,
  -- носители, вера, дипломатия, биржа, шпионаж, дотации и пр.
  perform public._faction_purge_tails(p_faction_id);

  -- Реестр карты
  delete from public.map_factions where id = p_faction_id;

  -- «Бедность»/беспорядки по обезлюдевшим системам
  perform public._system_econ_clear_orphans();

  -- Анкета (регистрация)
  delete from public.faction_applications where faction_id = p_faction_id;

  -- Роль владельца: player → viewer, чтобы мог подать новую анкету
  if v_owner_id is not null then
    update public.user_roles set role = 'viewer'
      where user_id = v_owner_id and role = 'player';
  end if;
end$$;
revoke all on function public.admin_delete_faction(text) from public;
grant execute on function public.admin_delete_faction(text) to authenticated;

-- ── 5) РАЗОВАЯ ДОЧИСТКА УЖЕ УДАЛЁННЫХ ФРАКЦИЙ ─────────────────
-- Сносит строки, чей fid отсутствует и в анкетах, и в реестре карты.
-- Возвращает суммарное число удалённых строк.
create or replace function public.admin_purge_orphans()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare rec record; pass int; progressed boolean; n bigint; total bigint := 0; n_sys int := 0;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  for pass in 1..8 loop
    progressed := false;
    for rec in select tbl, col from public._faction_ref_columns() loop
      begin
        execute format(
          'delete from public.%I t
             where t.%I is not null
               and not exists (select 1 from public.faction_applications a where a.faction_id = t.%I)
               and not exists (select 1 from public.map_factions m        where m.id        = t.%I)',
          rec.tbl, rec.col, rec.col, rec.col);
        get diagnostics n = row_count;
        if n > 0 then progressed := true; total := total + n; end if;
      exception when foreign_key_violation then
        progressed := true;
      end;
    end loop;
    exit when not progressed;
  end loop;

  -- Карта: обнулить владельца у систем мёртвых фракций
  if to_regclass('public.map_systems') is not null then
    update public.map_systems ms set faction = null
      where ms.faction is not null
        and not exists (select 1 from public.map_factions m where m.id = ms.faction);
  end if;

  n_sys := public._system_econ_clear_orphans();

  return jsonb_build_object('rows_deleted', total, 'system_econ', n_sys);
end$$;
revoke all on function public.admin_purge_orphans() from public;
grant execute on function public.admin_purge_orphans() to authenticated;

-- ============================================================
-- ПОСЛЕ ПРИМЕНЕНИЯ ФАЙЛА ВЫПОЛНИ ОДИН РАЗ (от роли postgres в
-- SQL Editor проверка роли не пройдёт — для разовой чистки используй
-- _purge_orphans_editor.sql, он без гейта и с отключением FK).
-- Из клиента/админки RPC admin_purge_orphans() и admin_delete_faction()
-- работают как обычно (JWT с ролью superadmin/editor).
-- ============================================================
