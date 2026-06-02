-- ════════════════════════════════════════════════════════════
-- БАЗОВЫЕ РЕСУРСЫ СТОЛИЧНЫХ ПЛАНЕТ
-- Столицы вводились позже и часто без сгенерированных ресурсов, поэтому на них
-- нечего добывать. Этот скрипт выдаёт КАЖДОЙ столице базовые «нежирные» ресурсы
-- (только common: Железо, Силикаты, Лёд, Углерод, Сера) по типу планеты.
-- Идемпотентно: заполняет только там, где ресурсов ещё нет.
-- Применить один раз в Supabase -> SQL Editor.
--
-- Иконки заданы Unicode-escape'ами (E'\uXXXX' / E'\U00XXXXXX') ВМЕСТО самих
-- эмодзи, иначе многобайтовые эмодзи ломают вставку в SQL-редактор. Соответствие:
--   Железо  = \u2699\uFE0F   Силикаты = \U0001FAA8   Лёд = \U0001F9CA
--   Углерод = \u2B1B         Сера     = \U0001F311
-- ════════════════════════════════════════════════════════════

-- Базовый набор ресурсов по типу (группе) планеты — только common.
create or replace function public._basic_capital_res(p_type text)
returns jsonb language sql immutable as $$
  select case
    when p_type = 'Землеподобные' then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Углерод','icon',E'\u2B1B','r','common'))
    when p_type = 'Океанические' then jsonb_build_array(
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Лёд','icon',E'\U0001F9CA','r','common'))
    when p_type = 'Пустынные' then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Сера','icon',E'\U0001F311','r','common'))
    when p_type = 'Криомиры' then jsonb_build_array(
      jsonb_build_object('name','Лёд','icon',E'\U0001F9CA','r','common'),
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
    when p_type in ('Вулканические','Лавовые миры') then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Сера','icon',E'\U0001F311','r','common'))
    when p_type = 'Экзотические' then jsonb_build_array(
      jsonb_build_object('name','Углерод','icon',E'\u2B1B','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
    else jsonb_build_array(   -- Малые тела, Столичный мир, кастомные/неизвестные
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
  end
$$;

-- Бэкфилл: для каждой одобренной фракции с выбранной столицей.
do $$
declare app record; cap text;
begin
  for app in
    select faction_id, system_id, planet_name, system_name
    from public.faction_applications where status='approved' and system_id is not null
  loop
    cap := coalesce(nullif(app.planet_name,''), app.system_name, 'Столица');

    -- 1) Карта: если столичная планета есть в системе и без ресурсов — выдаём базовые по её типу.
    update public.map_systems ms
      set planets = (
        select jsonb_agg(
          case when pl->>'name' = cap
                and jsonb_array_length(coalesce(pl->'resources','[]'::jsonb)) = 0
               then jsonb_set(pl, '{resources}', public._basic_capital_res(pl->>'type'))
               else pl end)
        from jsonb_array_elements(ms.planets) pl)
      where ms.id = app.system_id
        and exists (select 1 from jsonb_array_elements(ms.planets) p2
                    where p2->>'name' = cap
                      and jsonb_array_length(coalesce(p2->'resources','[]'::jsonb)) = 0);

    -- 2) Колония-столица: снимок ресурсов с карты, иначе — базовый набор (если планеты нет на карте).
    update public.colonies c
      set resources = coalesce(
        (select pl->'resources' from public.map_systems ms, jsonb_array_elements(ms.planets) pl
         where ms.id = app.system_id and pl->>'name' = cap
           and jsonb_array_length(coalesce(pl->'resources','[]'::jsonb)) > 0 limit 1),
        public._basic_capital_res('Столичный мир'))
      where c.faction_id = app.faction_id and c.planet_name = cap
        and jsonb_array_length(coalesce(c.resources,'[]'::jsonb)) = 0;
  end loop;
end$$;
