-- Персонажам негде было жить: мастер клал страницу под родителя-класс
-- ('soldiers', 'pilots', …), а таких страниц в вики нет — section оставался
-- NULL и анкета падала в «Разное». Заводим один постоянный раздел.
insert into sections (slug, name_ru, name_en, sort_order)
select 'characters', 'ПЕРСОНАЖИ', 'CHARACTERS', 5
 where not exists (select 1 from sections where slug = 'characters');

-- Уже созданные анкеты переселяем туда же.
update pages
   set section = 'characters'
 where page_type = 'character'
   and (section is null or section = '');
