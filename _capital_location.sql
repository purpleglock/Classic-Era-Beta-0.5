-- ============================================================
-- ЛОКАЦИЯ СТОЛИЦЫ — авто-генерация и синхронизация
--
-- При одобрении государства (и при заходе игрока во вкладку «Игровые
-- локации») для столичной колонии автоматически создаётся/обновляется
-- страница page_type='location' со слугом 'loc-cap-<faction_id>'.
--
-- Инфобокс-«досье» (Система / Сектор / Тип мира / Контроль / Статус)
-- ПЕРЕЗАПИСЫВАЕТСЯ при каждой синхронизации (источник истины — колония
-- + карта), а остальные блоки описания СОХРАНЯЮТСЯ — игрок/стафф их
-- редактирует обычным редактором локаций, и правки не затираются.
--
-- Применить целиком в Supabase → SQL Editor. Идемпотентно.
-- Требует: public.pages (slug PK, page_type, content text…),
--          public.colonies, public.map_systems, public.map_sectors,
--          public.faction_applications, public.current_user_role(),
--          public._env_label().
-- ============================================================

-- ── Ядро: построить/синхронизировать локацию столицы фракции ──
create or replace function public._ensure_capital_location(p_fid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  app       public.faction_applications;
  cap       public.colonies;
  existing  public.pages;
  fac_name  text;
  sys_id    text;
  sys_name  text;
  sec_name  text;
  ptype     text;
  planet    text;
  star      text;
  star_lbl  text;
  coords    text;
  size_lbl  text;
  sx        numeric;
  sy        numeric;
  v_slug    text;
  auto_sec  jsonb;
  user_secs jsonb;
  infobox   jsonb;
  ec        jsonb;
  old_ib    jsonb;
  other     jsonb;
  new_body  jsonb;
begin
  select * into app from public.faction_applications
    where faction_id = p_fid and status = 'approved'
    order by updated_at desc limit 1;
  if not found then return null; end if;
  fac_name := coalesce(nullif(app.name, ''), 'Государство');

  -- реальная столичная колония (источник истины); если её ещё нет — анкета
  select * into cap from public.colonies
    where faction_id = p_fid
    order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc
    limit 1;

  if cap.id is not null then
    planet   := coalesce(nullif(cap.planet_name, ''), 'Столица');
    ptype    := coalesce(nullif(cap.planet_type, ''), '—');
    sys_id   := cap.system_id;
    size_lbl := coalesce(cap.cells, 0) || ' ячеек застройки' ||
                case when cap.terraformed then ' · терраформ' else '' end;
  else
    planet := coalesce(nullif(app.planet_name, ''), nullif(app.system_name, ''), 'Столица');
    ptype  := coalesce(public._env_label(nullif(app.capital_env, '')), '—');
    sys_id := app.system_id;
  end if;

  select name, star_type, x, y into sys_name, star, sx, sy
    from public.map_systems where id = sys_id;
  sys_name := coalesce(nullif(sys_name, ''), nullif(app.system_name, ''), '—');

  -- класс звезды → читабельная метка
  star_lbl := case lower(coalesce(star, ''))
    when 'yellow' then 'Жёлтая' when 'blue' then 'Голубая' when 'red' then 'Красная'
    when 'white' then 'Белая' when 'orange' then 'Оранжевая' when 'red_giant' then 'Красный гигант'
    when 'neutron' then 'Нейтронная' when 'pulsar' then 'Пульсар' when 'blackhole' then 'Чёрная дыра'
    when 'binary' then 'Двойная' when 'superstar' then 'Суперзвезда'
    else coalesce(nullif(star, ''), '—') end;

  if sx is not null and sy is not null then
    coords := round(sx)::text || ' : ' || round(sy)::text;
  else
    coords := '—';
  end if;

  -- сектор: система состоит в нём (по массиву system_ids).
  -- Защита: если _map_sectors.sql не применён (нет таблицы) — просто пропускаем.
  begin
    select s.name into sec_name from public.map_sectors s
      where sys_id is not null and sys_id = any(s.system_ids)
      limit 1;
  exception when undefined_table then sec_name := null;
  end;
  sec_name := coalesce(nullif(sec_name, ''), '—');

  v_slug := 'loc-cap-' || p_fid;

  -- авто-секция «Основное»: ТОЛЬКО лорные якоря (где мир, какого типа, под
  -- каким солнцем, кто владеет). Игровая механика (ячейки/координаты/статус)
  -- сюда НЕ идёт — страница про РП-описание, а не дашборд. Перезаписывается
  -- при каждой синхронизации.
  auto_sec := jsonb_build_object(
    'name', 'Основное',
    'rows', jsonb_build_array(
      jsonb_build_object('key', 'Система',  'val', sys_name),
      jsonb_build_object('key', 'Сектор',   'val', sec_name),
      jsonb_build_object('key', 'Тип мира', 'val', ptype),
      jsonb_build_object('key', 'Звезда',   'val', star_lbl),
      jsonb_build_object('key', 'Владелец', 'val', fac_name)
    )
  );

  select * into existing from public.pages where slug = v_slug;
  if found then
    begin ec := existing.content::jsonb; exception when others then ec := '[]'::jsonb; end;
    if jsonb_typeof(ec) <> 'array' then ec := '[]'::jsonb; end if;
    -- из старого инфобокса забираем ПОЛЬЗОВАТЕЛЬСКИЕ секции (всё кроме «Основное»)
    select b into old_ib from jsonb_array_elements(ec) b where b->>'type' = 'infobox' limit 1;
    if old_ib is not null then
      select coalesce(jsonb_agg(s), '[]'::jsonb) into user_secs
        from jsonb_array_elements(coalesce(old_ib->'sections', '[]'::jsonb)) s
        where s->>'name' is distinct from 'Основное';
    else
      user_secs := '[]'::jsonb;
    end if;
    -- все НЕ-инфобокс блоки (описание игрока) сохраняем как есть
    select coalesce(jsonb_agg(b), '[]'::jsonb) into other
      from jsonb_array_elements(ec) b where b->>'type' <> 'infobox';
    infobox := jsonb_build_object(
      'type','infobox','id','cap-dossier','label','Досье локации','title', planet,
      'sections', jsonb_build_array(auto_sec) || coalesce(user_secs, '[]'::jsonb));
    new_body := jsonb_build_array(infobox) || coalesce(other, '[]'::jsonb);
    update public.pages
      set title      = planet,
          content    = new_body::text,
          page_type  = 'location',
          status     = case when status = 'draft' then status else 'published' end,
          updated_at = now()
      where slug = v_slug;
  else
    infobox := jsonb_build_object(
      'type','infobox','id','cap-dossier','label','Досье локации','title', planet,
      'sections', jsonb_build_array(auto_sec));
    new_body := jsonb_build_array(
      infobox,
      jsonb_build_object(
        'type', 'text', 'id', 'cap-desc',
        'content',
          '## ' || planet || E'\n' ||
          'Столичный мир государства «' || fac_name || '». ' ||
          E'Замените этот текст своим РП-описанием.\n\n' ||
          E'**Облик мира.** Какие у планеты небеса, ландшафты, города — что видит прибывший?\n\n' ||
          E'**Столица.** Главный град мира: его улицы, дворцы, дух.\n\n' ||
          E'**Народ и культура.** Кто здесь живёт, чем дышит, во что верит.\n\n' ||
          E'**Атмосфера места.** Чем этот мир запоминается — звуки, запахи, легенды.')
    );
    -- slug в public.pages НЕ имеет unique-констрейнта → без ON CONFLICT.
    -- Ветка выполняется только когда страницы ещё нет (проверено выше).
    insert into public.pages (slug, title, title_ru, content, page_type, status, sort_order, created_at, updated_at, created_by)
      values (v_slug, planet, '', new_body::text, 'location', 'published', 0, now(), now(), coalesce(app.owner_email, 'system'));
  end if;

  return v_slug;
end$$;
revoke all on function public._ensure_capital_location(text) from public;

-- ── Обёртка для игрока: синхронизировать локацию СВОЕЙ столицы ──
create or replace function public.ensure_my_capital_location()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare fid text;
begin
  select faction_id into fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' and faction_id is not null
    order by updated_at desc limit 1;
  if fid is null then return null; end if;
  return public._ensure_capital_location(fid);
end$$;
revoke all on function public.ensure_my_capital_location() from public;
grant execute on function public.ensure_my_capital_location() to authenticated;

-- ── Обёртка для стаффа: синхронизировать локацию столицы любой фракции ──
create or replace function public.ensure_capital_location(p_fid text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  return public._ensure_capital_location(p_fid);
end$$;
revoke all on function public.ensure_capital_location(text) from public;
grant execute on function public.ensure_capital_location(text) to authenticated;

-- ── Редактирование «заглавной инфы» локации столицы ──
-- Доступно ВЛАДЕЛЬЦУ столицы (своей) и стаффу (любой). Меняет:
--   • обложку (p_image_url: непусто — ставит, '' — убирает, null — не трогает);
--   • пользовательскую секцию досье «Дополнительно» (p_extra_rows: массив
--     {key,val}; null — не трогать). Авто-секцию «Основное» НЕ затрагивает —
--     она синхронизируется системой;
--   • описание (p_desc: текст — заменяет блоки описания одним текстовым;
--     null — не трогать).
create or replace function public.update_capital_location(
  p_slug       text,
  p_image_url  text default null,
  p_extra_rows jsonb default null,
  p_desc       text  default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pg        public.pages;
  is_staff  boolean;
  my_fid    text;
  ec        jsonb;
  old_ib    jsonb;
  auto_sec  jsonb;
  new_secs  jsonb;
  blocks    jsonb;
  rows_clean jsonb;
begin
  if p_slug is null or p_slug !~ '^loc-cap-' then
    raise exception 'bad slug';
  end if;
  is_staff := public.current_user_role() in ('superadmin','editor','moderator');
  if not is_staff then
    select faction_id into my_fid from public.faction_applications
      where owner_id = auth.uid() and status = 'approved' and faction_id is not null
      order by updated_at desc limit 1;
    if my_fid is null or p_slug <> 'loc-cap-' || my_fid then
      raise exception 'forbidden: not your capital';
    end if;
  end if;

  select * into pg from public.pages where slug = p_slug limit 1;
  if not found then raise exception 'location not found'; end if;

  begin ec := pg.content::jsonb; exception when others then ec := '[]'::jsonb; end;
  if jsonb_typeof(ec) <> 'array' then ec := '[]'::jsonb; end if;
  select b into old_ib from jsonb_array_elements(ec) b where b->>'type' = 'infobox' limit 1;

  -- авто-секция «Основное» сохраняется как есть
  if old_ib is not null then
    select s into auto_sec from jsonb_array_elements(coalesce(old_ib->'sections','[]'::jsonb)) s
      where s->>'name' = 'Основное' limit 1;
  end if;

  -- пользовательская секция «Дополнительно»
  if p_extra_rows is not null then
    if jsonb_typeof(p_extra_rows) <> 'array' then raise exception 'extra_rows must be array'; end if;
    -- чистим строки: только {key,val}, отбрасываем пустые ключи
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', trim(r->>'key'), 'val', coalesce(r->>'val',''))), '[]'::jsonb)
      into rows_clean
      from jsonb_array_elements(p_extra_rows) r
      where coalesce(trim(r->>'key'),'') <> '';
    new_secs := jsonb_build_array(coalesce(auto_sec, jsonb_build_object('name','Основное','rows','[]'::jsonb)))
                || (case when jsonb_array_length(rows_clean) > 0
                         then jsonb_build_array(jsonb_build_object('name','Дополнительно','rows',rows_clean))
                         else '[]'::jsonb end);
  else
    -- не трогаем секции — берём из старого инфобокса
    new_secs := coalesce(old_ib->'sections', jsonb_build_array(coalesce(auto_sec, jsonb_build_object('name','Основное','rows','[]'::jsonb))));
  end if;

  -- собираем блоки: инфобокс + блоки описания
  blocks := jsonb_build_array(jsonb_build_object(
    'type','infobox','id','cap-dossier','label','Досье локации',
    'title', coalesce(pg.title, ''), 'sections', new_secs));

  if p_desc is not null then
    blocks := blocks || jsonb_build_array(jsonb_build_object('type','text','id','cap-desc','content', p_desc));
  else
    -- сохраняем существующие блоки описания
    blocks := blocks || (select coalesce(jsonb_agg(b), '[]'::jsonb)
                           from jsonb_array_elements(ec) b where b->>'type' <> 'infobox');
  end if;

  update public.pages
    set content = blocks::text,
        image_url = case when p_image_url is null then image_url
                         when p_image_url = '' then null
                         else p_image_url end,
        updated_at = now()
    where slug = p_slug;

  return p_slug;
end$$;
revoke all on function public.update_capital_location(text, text, jsonb, text) from public;
grant execute on function public.update_capital_location(text, text, jsonb, text) to authenticated;

-- ── Одобрение анкеты: канон + авто-создание локации столицы ──
-- (полная копия public.approve_faction_application из _faction_setup.sql,
--  в конце добавлен вызов _ensure_capital_location — сбой локации НЕ
--  блокирует одобрение).
create or replace function public.approve_faction_application(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare app public.faction_applications; fid text; cap public.colonies;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: only superadmin/editor can approve';
  end if;
  select * into app from public.faction_applications where id = p_id;
  if not found then raise exception 'application not found'; end if;

  fid := 'fac_' || left(replace(p_id::text, '-', ''), 10);

  insert into public.map_factions (id, name, color, sort)
    values (fid, coalesce(app.name, 'Фракция'), coalesce(app.color, 'rgba(120,140,170,0.3)'), 100)
    on conflict (id) do update set name = excluded.name, color = excluded.color;

  if app.system_id is not null then
    update public.map_systems set faction = fid where id = app.system_id;
    update public.colonies set system_id = app.system_id
      where faction_id = fid
        and system_id is distinct from app.system_id
        and system_id not in (select id from public.map_systems where faction = fid);
  end if;

  if app.planet_name is not null and app.planet_name <> '' then
    select * into cap from public.colonies where faction_id = fid
      order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc limit 1;
    if found and cap.planet_name is distinct from app.planet_name then
      update public.map_systems ms set planets = (
        select jsonb_agg(
          case when (case when cap.planet_pid is not null
                          then (e->>'pid')::int = cap.planet_pid
                          else e->>'name' = cap.planet_name end)
               then jsonb_set(e, '{name}', to_jsonb(app.planet_name)) else e end)
        from jsonb_array_elements(ms.planets) e)
        where ms.id = cap.system_id
          and exists (select 1 from jsonb_array_elements(ms.planets) e2
                      where (case when cap.planet_pid is not null
                                  then (e2->>'pid')::int = cap.planet_pid
                                  else e2->>'name' = cap.planet_name end));
      update public.colonies set planet_name = app.planet_name where id = cap.id;
    end if;
  end if;

  update public.faction_applications
    set status = 'approved', pending_review = false, faction_id = fid, reviewed_by = auth.jwt() ->> 'email', updated_at = now()
    where id = p_id;

  update public.user_roles set role = 'player' where user_id = app.owner_id and role = 'viewer';
  if not found and not exists (select 1 from public.user_roles where user_id = app.owner_id) then
    insert into public.user_roles (user_id, role) values (app.owner_id, 'player');
  end if;

  -- авто-создание/синхронизация локации столицы (не критично для одобрения)
  begin perform public._ensure_capital_location(fid); exception when others then null; end;

  return fid;
end$$;
revoke all on function public.approve_faction_application(uuid) from public;
grant execute on function public.approve_faction_application(uuid) to authenticated;

-- ── Бэкфилл: создать локации столиц для уже одобренных государств ──
do $$
declare r record;
begin
  for r in select distinct faction_id from public.faction_applications
           where status = 'approved' and faction_id is not null
  loop
    begin perform public._ensure_capital_location(r.faction_id); exception when others then null; end;
  end loop;
end$$;
