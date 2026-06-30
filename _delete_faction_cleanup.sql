-- ============================================================
-- ДОЧИСТКА УДАЛЁННЫХ ФРАКЦИЙ — хвосты, которые admin_delete_faction
-- НЕ убирал: вера (паства), залпы межзвёздной артиллерии (вечный
-- обстрел на карте), мобильные «Длани» (Гиперпейсеры), дотации и
-- статус «бедность/беспорядки» по уже пустым системам.
--
-- ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ:
--   1) admin_delete_faction — расширенная версия: при удалении фракции
--      разом сносит её веру, залпы, орудия, носители, дотации и
--      сбрасывает экономический статус осиротевших систем.
--   2) admin_purge_orphans() — РАЗОВАЯ дочистка УЖЕ удалённых фракций
--      (тех, что снесли старой версией). Удаляет строки, чей faction_id
--      больше не существует ни в анкетах, ни на карте. Запусти ОДИН РАЗ
--      сразу после применения файла:  select public.admin_purge_orphans();
--
-- Все обращения к «опциональным» таблицам (вера/орудия/мза/дотации)
-- обёрнуты в to_regclass — файл безопасен, даже если соответствующий
-- срез у тебя ещё не применён.
--
-- Запустить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── ОБЩИЙ ХЕЛПЕР: снести все хвосты одной фракции ──────────────
-- Вызывается и из admin_delete_faction, и из admin_purge_orphans.
create or replace function public._faction_purge_tails(p_faction_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ВЕРА: членство (паства), основанные веры (каскадом снесут членство/
  -- предложения/секты по FK faith_id), предложения признания, секты.
  if to_regclass('public.faith_membership') is not null then
    delete from public.faith_membership where faction_id = p_faction_id;
  end if;
  if to_regclass('public.faiths') is not null then
    delete from public.faiths where founder_fid = p_faction_id;
  end if;
  if to_regclass('public.faith_offers') is not null then
    delete from public.faith_offers where from_fid = p_faction_id or to_fid = p_faction_id;
  end if;
  if to_regclass('public.faith_sects') is not null then
    delete from public.faith_sects where owner_fid = p_faction_id or host_fid = p_faction_id;
  end if;

  -- МЕЖЗВЁЗДНАЯ АРТИЛЛЕРИЯ: залпы в полёте (вечный обстрел на карте) и
  -- стационарные орудия. Орудия обычно каскадятся вместе с постройками,
  -- но залп остаётся (FK gun_id → SET NULL) — сносим явно.
  if to_regclass('public.doom_salvos') is not null then
    delete from public.doom_salvos where faction_id = p_faction_id;
  end if;
  if to_regclass('public.doom_guns') is not null then
    delete from public.doom_guns where faction_id = p_faction_id;
  end if;

  -- ГИПЕРПЕЙСЕР (мобильная «Длань»): носитель не привязан к постройкам и
  -- выживает целиком — сносим и его, и его залпы.
  if to_regclass('public.mza_ships') is not null then
    delete from public.mza_ships where faction_id = p_faction_id;
  end if;

  -- ДОТАЦИИ/ПАЙКИ/ИМПОРТ: бонусы просперити осиротевших систем.
  if to_regclass('public.econ_relief') is not null then
    delete from public.econ_relief where faction_id = p_faction_id;
  end if;
end$$;

revoke all on function public._faction_purge_tails(text) from public;

-- ── СБРОС «БЕДНОСТИ» ПО ПУСТЫМ СИСТЕМАМ ───────────────────────
-- system_econ ключ по system_id и хранит unrest/stagnation. После
-- удаления фракции её колонии снесены, а map_systems.faction обнулён —
-- но статус остаётся и рисует «бедность» на пустом месте. Чистим все
-- строки систем, у которых больше нет владельца на карте.
create or replace function public._system_econ_clear_orphans()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  if to_regclass('public.system_econ') is null then return 0; end if;
  if to_regclass('public.map_systems') is null then return 0; end if;
  delete from public.system_econ se
    where not exists (
      select 1 from public.map_systems ms
      where ms.id = se.system_id and ms.faction is not null
    );
  get diagnostics n = row_count;
  return n;
end$$;

revoke all on function public._system_econ_clear_orphans() from public;

-- ── 1) РАСШИРЕННОЕ УДАЛЕНИЕ ФРАКЦИИ ───────────────────────────
create or replace function public.admin_delete_faction(p_faction_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner_id uuid; v_owner_email text; v_name text;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  -- Сохраняем данные владельца/имя до удаления анкеты
  select owner_id, owner_email, name into v_owner_id, v_owner_email, v_name
    from public.faction_applications
    where faction_id = p_faction_id
    limit 1;

  -- Аудит: фиксируем, чью анкету удалили (требует таблицы из _admin_users.sql)
  insert into public.faction_deletions (faction_id, faction_name, owner_id, owner_email, deleted_by)
    values (p_faction_id, coalesce(v_name, p_faction_id), v_owner_id, v_owner_email, auth.jwt() ->> 'email');

  -- Игровые данные (порядок по FK-зависимостям).
  -- Внимание: у части таблиц колонка фракции называется НЕ faction_id:
  --   spy_missions → actor_fid / target_fid
  --   trade_routes → a_fid / b_fid
  --   loans        → lender_fid / borrower_fid
  delete from public.spy_missions     where actor_fid  = p_faction_id or target_fid   = p_faction_id;
  delete from public.trade_routes     where a_fid      = p_faction_id or b_fid        = p_faction_id;
  delete from public.loans            where lender_fid = p_faction_id or borrower_fid = p_faction_id;
  delete from public.unit_production  where faction_id = p_faction_id;
  delete from public.colony_buildings where faction_id = p_faction_id;
  delete from public.colonies         where faction_id = p_faction_id;
  delete from public.faction_economy  where faction_id = p_faction_id;
  delete from public.faction_units    where faction_id = p_faction_id;

  -- НОВОЕ: вера (паства), залпы/орудия артиллерии, Гиперпейсеры, дотации.
  perform public._faction_purge_tails(p_faction_id);

  -- Карта: FK map_systems.faction → map_factions(id) ON DELETE SET NULL
  -- автоматически зачищает faction во всех системах фракции
  delete from public.map_factions where id = p_faction_id;

  -- НОВОЕ: после обнуления владельцев систем — сбросить «бедность»/
  -- беспорядки по уже пустым системам (иначе статус висит на карте).
  perform public._system_econ_clear_orphans();

  -- Анкета (регистрация)
  delete from public.faction_applications where faction_id = p_faction_id;

  -- Роль: player → viewer, чтобы владелец мог подать новую анкету
  if v_owner_id is not null then
    update public.user_roles
      set role = 'viewer'
      where user_id = v_owner_id and role = 'player';
  end if;
end$$;

revoke all on function public.admin_delete_faction(text) from public;
grant execute on function public.admin_delete_faction(text) to authenticated;

-- ── 2) РАЗОВАЯ ДОЧИСТКА УЖЕ УДАЛЁННЫХ ФРАКЦИЙ ─────────────────
-- Снимает хвосты, чей faction_id больше не существует ни в анкетах,
-- ни в реестре карты (map_factions). Безопасно гонять повторно.
-- Возвращает отчёт: сколько чего вычищено.
create or replace function public.admin_purge_orphans()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n_salvos int := 0; n_guns int := 0; n_mza int := 0;
  n_fmem int := 0; n_faiths int := 0; n_foffers int := 0; n_fsects int := 0;
  n_relief int := 0; n_sysecon int := 0;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  -- «Живые» fid = есть анкета ИЛИ запись в реестре карты.
  -- Всё, чего там нет, считаем осиротевшим.
  create temporary table _live_fids on commit drop as
    select faction_id as fid from public.faction_applications
    union
    select id        as fid from public.map_factions;

  -- ВЕРА
  if to_regclass('public.faith_membership') is not null then
    delete from public.faith_membership
      where faction_id not in (select fid from _live_fids);
    get diagnostics n_fmem = row_count;
  end if;
  if to_regclass('public.faiths') is not null then
    delete from public.faiths
      where founder_fid not in (select fid from _live_fids);
    get diagnostics n_faiths = row_count;
  end if;
  if to_regclass('public.faith_offers') is not null then
    delete from public.faith_offers
      where from_fid not in (select fid from _live_fids)
         or to_fid   not in (select fid from _live_fids);
    get diagnostics n_foffers = row_count;
  end if;
  if to_regclass('public.faith_sects') is not null then
    delete from public.faith_sects
      where owner_fid not in (select fid from _live_fids)
         or host_fid  not in (select fid from _live_fids);
    get diagnostics n_fsects = row_count;
  end if;

  -- АРТИЛЛЕРИЯ
  if to_regclass('public.doom_salvos') is not null then
    delete from public.doom_salvos
      where faction_id not in (select fid from _live_fids);
    get diagnostics n_salvos = row_count;
  end if;
  if to_regclass('public.doom_guns') is not null then
    delete from public.doom_guns
      where faction_id not in (select fid from _live_fids);
    get diagnostics n_guns = row_count;
  end if;
  if to_regclass('public.mza_ships') is not null then
    delete from public.mza_ships
      where faction_id not in (select fid from _live_fids);
    get diagnostics n_mza = row_count;
  end if;

  -- ДОТАЦИИ
  if to_regclass('public.econ_relief') is not null then
    delete from public.econ_relief
      where faction_id not in (select fid from _live_fids);
    get diagnostics n_relief = row_count;
  end if;

  -- БЕДНОСТЬ/БЕСПОРЯДКИ по пустым системам
  n_sysecon := public._system_econ_clear_orphans();

  return jsonb_build_object(
    'doom_salvos',      n_salvos,
    'doom_guns',        n_guns,
    'mza_ships',        n_mza,
    'faith_membership', n_fmem,
    'faiths',           n_faiths,
    'faith_offers',     n_foffers,
    'faith_sects',      n_fsects,
    'econ_relief',      n_relief,
    'system_econ',      n_sysecon
  );
end$$;

revoke all on function public.admin_purge_orphans() from public;
grant execute on function public.admin_purge_orphans() to authenticated;

-- ============================================================
-- ПОСЛЕ ПРИМЕНЕНИЯ ФАЙЛА ВЫПОЛНИ ОДИН РАЗ:
--   select public.admin_purge_orphans();
-- Вернёт JSON со счётчиками вычищенного — это и снимет вечный
-- обстрел, фантомную паству и «бедность» удалённой фракции.
-- ============================================================
