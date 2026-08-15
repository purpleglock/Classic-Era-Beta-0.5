-- История изменений врала: в строке «ПРАВКА» показывался author_id — тот, кто
-- ЗАВЁЛ страницу (для вики-фракций это владелец державы, статью заводит триггер),
-- а не тот, кто правил последним. Заводим updated_by и пишем его триггером —
-- так покрыты все пути записи (редактор, персонажи, локации, инлайн-блоки),
-- а не только те, что найдены в клиенте.

alter table public.pages add column if not exists updated_by uuid;

create or replace function public._pages_stamp_editor() returns trigger
language plpgsql security invoker as $$
begin
  -- служебные накаты (service_role, SQL-миграции) идут без auth.uid() —
  -- такие правки автором не считаем: подпись остаётся той, что в строке
  -- (при UPDATE без упоминания колонки это и есть старое значение)
  if auth.uid() is null then return new; end if;
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_pages_stamp_editor on public.pages;
create trigger trg_pages_stamp_editor
  before insert or update on public.pages
  for each row execute function public._pages_stamp_editor();

-- задним числом: у нетронутых страниц последний правщик = автор
update public.pages set updated_by = author_id where updated_by is null;
