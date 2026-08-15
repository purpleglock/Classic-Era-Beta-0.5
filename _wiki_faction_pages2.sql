-- ============================================================
-- ДОБОР ПО СТАТЬЯМ ДЕРЖАВ: поглощённые и НПС
-- 1) status='annexed' (Совет Отверженных, Цветущий Пояс — вошли в состав
--    Соридонского Союза Систем) выпадали отовсюду: реестр показывает только
--    approved, и статьи им не заводились. Держава кончилась — её лор нет.
--    Теперь статья есть, а в инфобоксе строка «Статус: Поглощена».
-- 2) Признак НПС берётся из ЯРЛЫКА инфобокса: «NPC-фракция» вместо «Фракция».
--    Отдельной колонки в БД нет и быть не должно — оформление живёт в статье,
--    а игроки/админ меняют ярлык прямо в редакторе.
-- ============================================================

-- ── 1. статьи поглощённым державам ─────────────────────────
create or replace function public.wiki_faction_page_ensure(p_app_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  app    public.faction_applications;
  cap    record;
  sec    text;
  base   text;
  v_slug text;
  n      int := 1;
  cap_s  text;
  rows_j jsonb;
  blocks jsonb;
begin
  select * into app from public.faction_applications where id = p_app_id;
  -- Поглощённая держава тоже получает статью: её история осталась в мире.
  if not found or app.status not in ('approved', 'annexed') or coalesce(app.name, '') = '' then return null; end if;

  select p.slug into v_slug from public.pages p
   where regexp_replace(lower(replace(coalesce(p.title, p.title_ru, ''), 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g')
       = regexp_replace(lower(replace(app.name, 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g')
   limit 1;
  if v_slug is not null then return v_slug; end if;

  select s.slug into sec from public.sections s
   where s.slug = 'wiki-fraction' or s.slug like '%frac%' or s.slug like '%frak%'
   order by (s.slug = 'wiki-fraction') desc limit 1;
  if sec is null then return null; end if;

  base := public.wiki_slug_name(app.name);
  v_slug := base;
  while exists (select 1 from public.pages where pages.slug = v_slug) loop
    n := n + 1; v_slug := base || '-' || n;
  end loop;

  select c.planet_name, ms.name as sys_name into cap
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
   where c.faction_id = app.faction_id
   order by c.is_capital desc nulls last, (c.planet_type = 'Столичный мир') desc, c.created_at asc
   limit 1;
  cap_s := coalesce(nullif(concat_ws(' / ', coalesce(cap.sys_name, app.system_name),
                                     coalesce(cap.planet_name, app.planet_name)), ''), '—');

  rows_j := '[]'::jsonb;
  if app.status = 'annexed' then
    rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Статус', 'val', 'Поглощена'));
  end if;
  if coalesce(app.civ_type, '') <> '' then
    rows_j := rows_j || jsonb_build_array(jsonb_build_object(
      'key', 'Тип', 'val', case app.civ_type when 'frontier' then 'Фронтир' when 'colony' then 'Колония' else app.civ_type end));
  end if;
  rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Столица', 'val', cap_s));
  if coalesce(app.leader, '')   <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Глава',     'val', app.leader)); end if;
  if coalesce(app.gov, '')      <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Строй',     'val', app.gov)); end if;
  if coalesce(app.regime, '')   <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Режим',     'val', app.regime)); end if;
  if coalesce(app.race, '')     <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Раса',      'val', app.race)); end if;
  if coalesce(app.ideology, '') <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Идеология', 'val', app.ideology)); end if;

  blocks := jsonb_build_array(jsonb_build_object(
    'type', 'infobox',
    'id', 'ibfac' || left(replace(p_app_id::text, '-', ''), 6),
    'label', case when app.status = 'annexed' then 'Поглощённая держава' else 'Фракция' end,
    'title', app.name,
    'image_url', coalesce(app.herald_url, ''),
    'sections', jsonb_build_array(jsonb_build_object('name', 'Основное', 'rows', rows_j))
  ));
  if coalesce(app.history, '') <> '' then
    blocks := blocks || jsonb_build_array(
      jsonb_build_object('type', 'heading', 'id', 'hh' || left(replace(p_app_id::text, '-', ''), 6), 'text', 'КРАТКАЯ ИСТОРИЯ', 'style', 'h-glitch'),
      jsonb_build_object('type', 'text',    'id', 'ht' || left(replace(p_app_id::text, '-', ''), 6), 'content', app.history));
  end if;
  if coalesce(app.culture, '') <> '' then
    blocks := blocks || jsonb_build_array(
      jsonb_build_object('type', 'heading', 'id', 'ch' || left(replace(p_app_id::text, '-', ''), 6), 'text', 'КУЛЬТУРА', 'style', 'h-glitch'),
      jsonb_build_object('type', 'text',    'id', 'ct' || left(replace(p_app_id::text, '-', ''), 6), 'content', app.culture));
  end if;

  insert into public.pages (slug, title, section, page_type, status, content, image_url, author_id, created_by, sort_order)
  values (v_slug, app.name, sec, 'faction', 'published', blocks::text,
          nullif(app.herald_url, ''), app.owner_id, app.owner_email, 100);

  return v_slug;
end$$;

do $$
declare r record; s text;
begin
  for r in select id, name from public.faction_applications where status = 'annexed' order by name loop
    s := public.wiki_faction_page_ensure(r.id);
    raise notice 'поглощённая % → %', r.name, coalesce(s, '(уже есть)');
  end loop;
end$$;

-- ── 2. пометить НПС ────────────────────────────────────────
-- Ярлык инфобокса «NPC-фракция» — по нему реестр выносит их отдельным блоком
-- наверх раздела. Помечаем названных: остальным ярлык ставится в редакторе.
update public.pages
   set content = jsonb_set(content::jsonb, '{0,label}', '"NPC-фракция"'::jsonb)::text,
       updated_at = now()
 where page_type = 'faction'
   and title in ('Железный Дивизион', 'Управление Храма Мироздания', 'Эрлендийские тенёта')
   and (content::jsonb -> 0 ->> 'type') = 'infobox';
