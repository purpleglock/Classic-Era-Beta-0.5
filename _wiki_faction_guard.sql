-- ============================================================
-- ИНФОБОКС ДЕРЖАВЫ — НЕ ЛАЗЕЙКА В ОБХОД ПЕРЕРЕГИСТРАЦИИ
-- Оформление державы переехало в вики-статью, и вместе с ним туда чуть не
-- переехала возможность молча переименовать государство, сменить столицу,
-- главу или расу — то, что меняется ТОЛЬКО через анкету и подтверждение
-- модерации (approve_faction_application).
-- Правило: источник правды — faction_applications. Игрок правит статью
-- свободно (история, культура, картинки, свои строки инфобокса), но
-- критичные строки и заголовок при каждом сохранении возвращаются к данным
-- анкеты. Изменил анкету, прошёл проверку — статья обновилась сама.
-- ============================================================

-- Явная связь «статья ↔ анкета»: по названию её держать нельзя, ведь именно
-- название игрок и мог бы попытаться сменить.
alter table public.pages add column if not exists faction_app_id uuid;
create index if not exists pages_faction_app_id_idx on public.pages (faction_app_id);

update public.pages p
   set faction_app_id = a.id
  from public.faction_applications a
 where p.faction_app_id is null
   and p.page_type = 'faction'
   and a.status in ('approved', 'annexed')
   and regexp_replace(lower(replace(coalesce(p.title, ''), 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g')
     = regexp_replace(lower(replace(a.name, 'ё', 'е')), '[^a-zа-я0-9]+', '', 'g');

-- ── Заменить/добавить строку инфобокса (блок 0) ────────────
create or replace function public.wiki_ib_set(p_blocks jsonb, p_key text, p_val text)
returns jsonb
language plpgsql
immutable
as $$
declare
  ib   jsonb;
  secs jsonb;
  i    int;
  j    int;
  rows_j jsonb;
  found boolean := false;
begin
  ib := p_blocks -> 0;
  if ib is null or ib ->> 'type' <> 'infobox' then return p_blocks; end if;
  secs := coalesce(ib -> 'sections', '[]'::jsonb);
  for i in 0 .. jsonb_array_length(secs) - 1 loop
    rows_j := coalesce(secs -> i -> 'rows', '[]'::jsonb);
    for j in 0 .. jsonb_array_length(rows_j) - 1 loop
      if lower(coalesce(rows_j -> j ->> 'key', '')) = lower(p_key) then
        rows_j := jsonb_set(rows_j, array[j::text, 'val'], to_jsonb(coalesce(p_val, '')));
        found := true;
      end if;
    end loop;
    secs := jsonb_set(secs, array[i::text, 'rows'], rows_j);
  end loop;
  -- Строки нет, а значение есть — добавляем в первую секцию: игрок мог удалить
  -- её из инфобокса, но столица державы обязана быть видна как есть.
  if not found and coalesce(p_val, '') <> '' then
    if jsonb_array_length(secs) = 0 then
      secs := jsonb_build_array(jsonb_build_object('name', 'Основное', 'rows', '[]'::jsonb));
    end if;
    secs := jsonb_set(secs, array['0', 'rows'],
      coalesce(secs -> 0 -> 'rows', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', p_key, 'val', p_val)));
  end if;
  return jsonb_set(p_blocks, '{0,sections}', secs);
end$$;

-- ── Привести инфобокс статьи в соответствие анкете ─────────
create or replace function public.wiki_faction_infobox_sync(p_content text, p_app_id uuid)
returns text
language plpgsql
stable
as $$
declare
  app    public.faction_applications;
  cap    record;
  blocks jsonb;
  cap_s  text;
begin
  select * into app from public.faction_applications where id = p_app_id;
  if not found then return p_content; end if;
  begin blocks := p_content::jsonb; exception when others then return p_content; end;
  if jsonb_typeof(blocks) <> 'array' or blocks -> 0 ->> 'type' <> 'infobox' then return p_content; end if;

  select c.planet_name, ms.name as sys_name into cap
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
   where c.faction_id = app.faction_id
   order by c.is_capital desc nulls last, (c.planet_type = 'Столичный мир') desc, c.created_at asc
   limit 1;
  cap_s := coalesce(nullif(concat_ws(' / ', coalesce(cap.sys_name, app.system_name),
                                     coalesce(cap.planet_name, app.planet_name)), ''), '—');

  -- Заголовок инфобокса = название державы из анкеты.
  blocks := jsonb_set(blocks, '{0,title}', to_jsonb(app.name));
  blocks := public.wiki_ib_set(blocks, 'Столица',   cap_s);
  blocks := public.wiki_ib_set(blocks, 'Глава',     coalesce(app.leader, ''));
  blocks := public.wiki_ib_set(blocks, 'Строй',     coalesce(app.gov, ''));
  blocks := public.wiki_ib_set(blocks, 'Режим',     coalesce(app.regime, ''));
  blocks := public.wiki_ib_set(blocks, 'Раса',      coalesce(app.race, ''));
  blocks := public.wiki_ib_set(blocks, 'Идеология', coalesce(app.ideology, ''));
  blocks := public.wiki_ib_set(blocks, 'Тип',
    case app.civ_type when 'frontier' then 'Фронтир' when 'colony' then 'Колония' else coalesce(app.civ_type, '') end);
  if app.status = 'annexed' then
    blocks := public.wiki_ib_set(blocks, 'Статус', 'Поглощена');
  end if;
  return blocks::text;
end$$;

-- ── Страж правки статьи державы ────────────────────────────
create or replace function public.tg_faction_page_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare app public.faction_applications;
begin
  if new.faction_app_id is null then return new; end if;
  select * into app from public.faction_applications where id = new.faction_app_id;
  if not found then return new; end if;

  -- Название державы меняется перерегистрацией анкеты, а не правкой статьи.
  new.title := app.name;
  new.page_type := 'faction';
  new.faction_app_id := old.faction_app_id;   -- перепривязать статью к чужой анкете нельзя
  new.content := public.wiki_faction_infobox_sync(new.content, new.faction_app_id);
  return new;
end$$;

drop trigger if exists faction_page_guard on public.pages;
create trigger faction_page_guard
  before update on public.pages
  for each row execute function public.tg_faction_page_guard();

-- ── Одобренные изменения анкеты → в статью ─────────────────
-- Раньше триггер только СОЗДАВАЛ статью. Теперь он же подтягивает в неё
-- утверждённые модерацией правки: иначе после переименования держава
-- называлась бы по-новому в реестре и по-старому в собственной статье.
create or replace function public.tg_faction_page_ensure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_slug text;
begin
  if new.status not in ('approved', 'annexed') then return new; end if;
  v_slug := public.wiki_faction_page_ensure(new.id);
  if v_slug is null then return new; end if;
  update public.pages
     set faction_app_id = new.id,
         title = new.name,
         content = public.wiki_faction_infobox_sync(content, new.id),
         updated_at = now()
   where slug = v_slug;
  return new;
end$$;

drop trigger if exists faction_app_page_ensure on public.faction_applications;
create trigger faction_app_page_ensure
  after insert or update on public.faction_applications
  for each row execute function public.tg_faction_page_ensure();

-- Разовая сверка: подтянуть в уже созданные статьи текущие данные анкет.
update public.pages p
   set content = public.wiki_faction_infobox_sync(p.content, p.faction_app_id),
       title = a.name
  from public.faction_applications a
 where p.faction_app_id = a.id;
