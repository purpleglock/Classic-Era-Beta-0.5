-- ============================================================
-- ВИКИ-СТАТЬЯ ДЛЯ КАЖДОГО СОЮЗА
-- Продолжение _wiki_faction_pages.sql: у держав статья появляется сама, а
-- альянсы оставались без оформления — их карточка в реестре была пустой
-- рамкой. Правило то же: создаём ТОЛЬКО недостающие статьи.
-- Сверка имени нестрогая: «Альянс Организации Межзвездного Договора» — это
-- та же «Организация Межзвездного Договора», и второй статьи ей не нужно.
-- ============================================================

create or replace function public.wiki_union_page_ensure(p_union_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  u      public.diplo_unions;
  sec    text;
  base   text;
  v_slug text;
  n      int := 1;
  lead_n text;
  mem    int;
  rows_j jsonb;
  blocks jsonb;
  key_u  text;
begin
  select * into u from public.diplo_unions where id = p_union_id;
  if not found or coalesce(u.status, '') <> 'approved' or coalesce(u.name, '') = '' then return null; end if;

  -- Значимые основы названия: склонения и родовое слово («альянс», «союз»)
  -- не должны плодить двойника уже написанной статьи.
  key_u := regexp_replace(lower(replace(u.name, 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g');
  select p.slug into v_slug from public.pages p
   where regexp_replace(lower(replace(coalesce(p.title, p.title_ru, ''), 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g') = key_u
      -- Хвост названия совпадает («…межзвездногодоговора»): различаются только
      -- родовое слово и падеж в начале — это одна и та же организация.
      or (length(key_u) >= 16
          and right(regexp_replace(lower(replace(coalesce(p.title, p.title_ru, ''), 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g'), 16)
              = right(key_u, 16))
   limit 1;
  if v_slug is not null then return v_slug; end if;

  select s.slug into sec from public.sections s
   where s.slug = 'wiki-fraction' or s.slug like '%frac%' or s.slug like '%frak%'
   order by (s.slug = 'wiki-fraction') desc limit 1;
  if sec is null then return null; end if;

  base := public.wiki_slug_name(u.name);
  v_slug := base;
  while exists (select 1 from public.pages where pages.slug = v_slug) loop
    n := n + 1; v_slug := base || '-' || n;
  end loop;

  select a.name into lead_n from public.faction_applications a
   where a.faction_id = u.leader_fid and a.status = 'approved' limit 1;
  select count(*) into mem from public.diplo_members m where m.union_id = u.id;

  rows_j := jsonb_build_array(
    jsonb_build_object('key', 'Тип', 'val', case u.kind when 'federation' then 'Федерация' else 'Конфедерация' end));
  if coalesce(lead_n, '') <> '' then
    rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Ведущая держава', 'val', lead_n));
  end if;
  rows_j := rows_j || jsonb_build_array(jsonb_build_object('key', 'Участников', 'val', coalesce(mem, 0)::text));

  blocks := jsonb_build_array(jsonb_build_object(
    'type', 'infobox',
    'id', 'ibuni' || left(replace(p_union_id::text, '-', ''), 6),
    'label', 'Союз',
    'title', u.name,
    'image_url', coalesce(u.herald_url, ''),
    'sections', jsonb_build_array(jsonb_build_object('name', 'Основное', 'rows', rows_j))
  ));
  if coalesce(u.description, '') <> '' then
    blocks := blocks || jsonb_build_array(
      jsonb_build_object('type', 'heading', 'id', 'uh' || left(replace(p_union_id::text, '-', ''), 6), 'text', 'О СОЮЗЕ', 'style', 'h-glitch'),
      jsonb_build_object('type', 'text',    'id', 'ut' || left(replace(p_union_id::text, '-', ''), 6), 'content', u.description));
  end if;

  insert into public.pages (slug, title, section, page_type, status, content, image_url, sort_order)
  values (v_slug, u.name, sec, 'faction', 'published', blocks::text, nullif(u.herald_url, ''), 110);

  return v_slug;
end$$;

revoke all on function public.wiki_union_page_ensure(uuid) from public;
grant execute on function public.wiki_union_page_ensure(uuid) to authenticated;

create or replace function public.tg_union_page_ensure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' then perform public.wiki_union_page_ensure(new.id); end if;
  return new;
end$$;

drop trigger if exists diplo_union_page_ensure on public.diplo_unions;
create trigger diplo_union_page_ensure
  after insert or update of status on public.diplo_unions
  for each row execute function public.tg_union_page_ensure();

do $$
declare r record; s text;
begin
  for r in select id, name from public.diplo_unions where status = 'approved' order by name loop
    s := public.wiki_union_page_ensure(r.id);
    raise notice '% → %', r.name, coalesce(s, '(уже есть)');
  end loop;
end$$;
