-- Флаг оккупации переживал удаление фракции.
--
-- Почему: единственная уборка (в occupations_all) — «снять, если стороны
-- больше не воюют». Но при удалении фракции строки wars/war_sides остаются,
-- at_war() по-прежнему true, и флаг чужой (уже несуществующей) державы висит
-- на карте вечно. См. [[delete-faction-orphans]].
--
-- Чиним с двух концов:
--   1) _faction_purge_tails — при удалении фракции сносим её оккупации,
--      войны, предложения мира и флоты;
--   2) occupations_all — подметает строки, где любой из фидов уже не
--      существует (страховка для фракций, удалённых до этой заплатки).

-- ── 1) Хвосты удаляемой фракции: война и оккупация ──────────────────────
create or replace function public._faction_purge_tails(p_faction_id text)
returns void language plpgsql security definer set search_path to 'public' as $function$
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

  -- НОВОЕ: ОККУПАЦИЯ — флаг на карте с обеих сторон (и как захватчик,
  -- и как хозяин: иначе флаг живого соседа висит над пустотой).
  if to_regclass('public.system_occupation') is not null then
    delete from public.system_occupation
     where occupier_fid = p_faction_id or owner_fid = p_faction_id;
  end if;

  -- НОВОЕ: ВОЙНА — иначе at_war() остаётся true по осиротевшим war_sides
  -- и уборка оккупаций в occupations_all не срабатывает.
  if to_regclass('public.war_offers') is not null then
    delete from public.war_offers where from_fid = p_faction_id or to_fid = p_faction_id;
  end if;
  if to_regclass('public.war_sides') is not null then
    delete from public.war_sides where fid = p_faction_id;
    -- Война, где не осталось двух сторон, — закончилась.
    update public.wars w set status = 'done', ended_at = coalesce(w.ended_at, now())
     where w.status = 'active'
       and (select count(distinct s.side) from public.war_sides s where s.war_id = w.id) < 2;
  end if;

  -- НОВОЕ: ФЛОТЫ — иначе призрачный флот стоит в системе и при следующем
  -- _fleet_settle снова поднимает флаг.
  if to_regclass('public.fleets') is not null then
    delete from public.fleets where faction_id = p_faction_id;
  end if;
end$function$;

-- ── 2) occupations_all: подметание мёртвых фидов ────────────────────────
create or replace function public.occupations_all()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare fid text;
begin
  -- Обход по СВОИМ флотам: чужие оккупации поднимет их владелец, когда
  -- откроет карту или кабинет. Иначе один запрос тянул бы весь сектор.
  begin
    fid := public._ec_my_fid();
    perform public._fleet_settle(fid);   -- settle + sweep
  exception when others then null;        -- гость/без фракции — просто читаем
  end;

  -- Удалённая держава войны не ведёт: снимаем флаг раньше проверки at_war
  -- (осиротевшие war_sides держали бы at_war=true вечно).
  delete from public.system_occupation o
   where not exists (select 1 from public.map_factions f where f.id = o.occupier_fid)
      or not exists (select 1 from public.map_factions f where f.id = o.owner_fid);

  begin
    delete from public.system_occupation o
     where not public.at_war(o.occupier_fid, o.owner_fid);
  exception when undefined_function then null; end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'system_id', o.system_id,
      'occupier', o.occupier_fid,
      'occupier_name', public._war_nm(o.occupier_fid),
      'occupier_color', (select mf.color from public.map_factions mf where mf.id = o.occupier_fid),
      'owner', o.owner_fid,
      'owner_name', public._war_nm(o.owner_fid),
      'since', o.since) order by o.since desc)
    from public.system_occupation o), '[]'::jsonb);
end$function$;
revoke all on function public.occupations_all() from public;
grant execute on function public.occupations_all() to authenticated;

-- ── 3) Разовая уборка за уже удалёнными фракциями ───────────────────────
delete from public.system_occupation o
 where not exists (select 1 from public.map_factions f where f.id = o.occupier_fid)
    or not exists (select 1 from public.map_factions f where f.id = o.owner_fid);

delete from public.war_offers x
 where not exists (select 1 from public.map_factions f where f.id = x.from_fid)
    or not exists (select 1 from public.map_factions f where f.id = x.to_fid);

delete from public.war_sides s
 where not exists (select 1 from public.map_factions f where f.id = s.fid);

update public.wars w set status = 'done', ended_at = coalesce(w.ended_at, now())
 where w.status = 'active'
   and (select count(distinct s.side) from public.war_sides s where s.war_id = w.id) < 2;

delete from public.fleets fl
 where not exists (select 1 from public.map_factions f where f.id = fl.faction_id);

-- Проверка:
-- 1) select * from public.system_occupation;  — нет строк с мёртвыми фидами.
-- 2) Удалить тестовую фракцию в «Управлении» → её флаги и флоты исчезли,
--    война закрыта (status='done').
