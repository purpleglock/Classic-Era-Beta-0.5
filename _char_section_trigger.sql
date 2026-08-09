-- Раздел для анкеты нельзя оставлять на совести клиента: у игрока может быть
-- закэширован старый character.js, и персонаж снова уедет в «Разное».
-- Сажаем его в «Персонажи» на входе в таблицу.
create or replace function public._pg_char_section()
returns trigger language plpgsql as $$
begin
  if new.page_type = 'character' and coalesce(new.section, '') = '' then
    new.section := 'characters';
  end if;
  return new;
end $$;

drop trigger if exists trg_pg_char_section on public.pages;
create trigger trg_pg_char_section
  before insert or update of page_type, section on public.pages
  for each row execute function public._pg_char_section();

-- Добираем тех, кто успел родиться сиротой.
update pages
   set section = 'characters'
 where page_type = 'character'
   and coalesce(section, '') = '';
