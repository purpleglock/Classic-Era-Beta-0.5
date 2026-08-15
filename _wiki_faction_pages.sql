-- ============================================================
-- ВИКИ-СТАТЬЯ ДЛЯ КАЖДОЙ ДЕРЖАВЫ
-- Раздел «Фракции» дублировал «Вики фракций»: одна и та же держава жила и
-- карточкой реестра, и статьёй. Теперь оформление державы — ЭТО инфобокс её
-- вики-статьи, а реестр только показывает его. Чтобы у всех уже одобренных
-- держав такая статья была, здесь:
--   1) wiki_slugify()            — имя державы → slug латиницей;
--   2) wiki_faction_page_ensure()— заготовка статьи из анкеты, ЕСЛИ её ещё нет;
--   3) триггер на одобрение анкеты — новым державам статья заводится сама;
--   4) разовый бэкфилл по всем одобренным;
--   5) RLS: владелец державы правит свою статью (как автор персонажа — свою).
-- Существующие статьи НЕ трогаются: ни содержимое, ни обложка — только
-- недостающие создаются, иначе ручная работа авторов была бы затёрта.
-- ============================================================

-- ── 1. slug ────────────────────────────────────────────────
create or replace function public.wiki_slugify(p_txt text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(translate(
          coalesce(p_txt, ''),
          'абвгдезийклмнопрстуфхцыэАБВГДЕЗИЙКЛМНОПРСТУФХЦЫЭ',
          'abvgdezijklmnoprstufhcyeabvgdezijklmnoprstufhcye'
        )),
        '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'),
    '')
$$;
-- Буквы, которым нужна не одна латинская: их translate() выше не покрывает.
create or replace function public.wiki_slug_name(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    public.wiki_slugify(
      replace(replace(replace(replace(replace(replace(replace(replace(
        lower(coalesce(p_name, '')),
        'ж','zh'), 'ч','ch'), 'ш','sh'), 'щ','sch'), 'ю','yu'), 'я','ya'), 'ё','e'), 'ъ','')
    ), 'faction')
$$;

-- ── 2. заготовка статьи ────────────────────────────────────
-- Возвращает slug страницы державы: существующей или только что созданной.
create or replace function public.wiki_faction_page_ensure(p_app_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  app   public.faction_applications;
  cap   record;
  sec   text;
  base  text;
  v_slug  text;
  n     int := 1;
  cap_s text;
  rows_j jsonb;
  blocks jsonb;
begin
  select * into app from public.faction_applications where id = p_app_id;
  if not found or app.status <> 'approved' or coalesce(app.name, '') = '' then return null; end if;

  -- Уже есть статья с таким названием (в любом разделе) — это она и есть.
  -- Сверяем «схлопнутое» имя: регистр, ё/е и пунктуация не должны плодить двойников.
  select p.slug into v_slug from public.pages p
   where regexp_replace(lower(replace(coalesce(p.title, p.title_ru, ''), 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g')
       = regexp_replace(lower(replace(app.name, 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g')
   limit 1;
  if v_slug is not null then return v_slug; end if;

  -- Раздел «Вики фракций». Нет такого — статью не выдумываем.
  select s.slug into sec from public.sections s
   where s.slug = 'wiki-fraction' or s.slug like '%frac%' or s.slug like '%frak%'
   order by (s.slug = 'wiki-fraction') desc limit 1;
  if sec is null then return null; end if;

  base := public.wiki_slug_name(app.name);
  v_slug := base;
  while exists (select 1 from public.pages where pages.slug = v_slug) loop
    n := n + 1; v_slug := base || '-' || n;
  end loop;

  -- Столица — из РЕАЛЬНОЙ столичной колонии, как её показывает реестр,
  -- а не из анкеты: анкета устаревает после первого же переезда.
  select c.planet_name, ms.name as sys_name into cap
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
   where c.faction_id = app.faction_id
   order by c.is_capital desc nulls last, (c.planet_type = 'Столичный мир') desc, c.created_at asc
   limit 1;
  cap_s := coalesce(nullif(concat_ws(' / ', coalesce(cap.sys_name, app.system_name),
                                     coalesce(cap.planet_name, app.planet_name)), ''), '—');

  rows_j := '[]'::jsonb;
  if coalesce(app.civ_type, '') <> '' then
    rows_j := rows_j || jsonb_build_array(jsonb_build_object(
      'key', 'Тип', 'val', case app.civ_type when 'frontier' then 'Фронтир' when 'colony' then 'Колония' else app.civ_type end));
  end if;
  rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Столица', 'val', cap_s));
  if coalesce(app.leader, '')   <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Глава',      'val', app.leader)); end if;
  if coalesce(app.gov, '')      <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Строй',      'val', app.gov)); end if;
  if coalesce(app.regime, '')   <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Режим',      'val', app.regime)); end if;
  if coalesce(app.race, '')     <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Раса',       'val', app.race)); end if;
  if coalesce(app.ideology, '') <> '' then rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Идеология',  'val', app.ideology)); end if;

  blocks := jsonb_build_array(jsonb_build_object(
    'type', 'infobox',
    'id', 'ibfac' || left(replace(p_app_id::text, '-', ''), 6),
    'label', 'Фракция',
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

revoke all on function public.wiki_faction_page_ensure(uuid) from public;
grant execute on function public.wiki_faction_page_ensure(uuid) to authenticated;

-- ── 3. новая держава получает статью сама ──────────────────
create or replace function public.tg_faction_page_ensure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' then
    perform public.wiki_faction_page_ensure(new.id);
  end if;
  return new;
end$$;

drop trigger if exists faction_app_page_ensure on public.faction_applications;
create trigger faction_app_page_ensure
  after insert or update of status on public.faction_applications
  for each row execute function public.tg_faction_page_ensure();

-- ── 4. бэкфилл по уже созданным державам ───────────────────
-- Только недостающие: у кого статья есть (Ост-Фронтирское Государство и др.) —
-- второй такой же не появится.
do $$
declare r record; s text;
begin
  for r in select id, name from public.faction_applications where status = 'approved' order by name loop
    s := public.wiki_faction_page_ensure(r.id);
    raise notice '% → %', r.name, coalesce(s, '(пропущено)');
  end loop;
end$$;

-- ── 5. владелец правит статью своей державы ────────────────
drop policy if exists "fac_own_update" on public.pages;
create policy "fac_own_update" on public.pages for update to authenticated
  using (page_type = 'faction' and author_id = auth.uid())
  with check (page_type = 'faction' and author_id = auth.uid());
