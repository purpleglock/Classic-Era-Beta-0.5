-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ДАТЫ В ЛЕТОПИСИ
--
-- Летопись (primitive_civs.chronicle) — это [{ph,text,scar?}]. Записи бывают
-- двух сортов, и путать их нельзя:
--   • «дописанное прошлое» — то, что генератор развернул при создании мира.
--     Это тысячелетия ИХ истории, у неё нет и не может быть нашей даты.
--   • «живые» записи — недельный шаг истории и вмешательства игроков.
--     Вот они происходят при нас, и у них дата обязана быть.
--
-- Стемпим не в каждой функции по отдельности (их пять и будет больше), а одним
-- триггером на таблицу: любой элемент летописи без ключа 'at' получает время
-- записи. Прошлое при этом не трогаем — старые записи так и остаются без даты,
-- клиент показывает их как «до контакта».
-- ════════════════════════════════════════════════════════════

create or replace function public._pc_chron_stamp()
returns trigger language plpgsql set search_path=public as $$
declare v_old int;
begin
  if tg_op = 'UPDATE' and new.chronicle is not distinct from old.chronicle then
    return new;
  end if;
  if new.chronicle is null or jsonb_typeof(new.chronicle) <> 'array'
     or jsonb_array_length(new.chronicle) = 0 then
    return new;
  end if;
  -- на INSERT (генерация мира) прошлое остаётся без дат: оно не при нас случилось
  if tg_op = 'INSERT' then return new; end if;

  -- дату получают ТОЛЬКО дописанные этим апдейтом хвостовые записи;
  -- всё, что уже лежало в летописи, не переписываем задним числом
  v_old := case when old.chronicle is null or jsonb_typeof(old.chronicle) <> 'array'
                then 0 else jsonb_array_length(old.chronicle) end;
  if jsonb_array_length(new.chronicle) <= v_old then return new; end if;

  select coalesce(jsonb_agg(
           case when ord <= v_old or e ? 'at' then e
                else e || jsonb_build_object('at', to_char(now() at time zone 'utc',
                                                           'YYYY-MM-DD"T"HH24:MI:SS"Z"')) end
           order by ord), '[]'::jsonb)
    into new.chronicle
    from jsonb_array_elements(new.chronicle) with ordinality t(e, ord);
  return new;
end$$;

drop trigger if exists trg_pc_chron_stamp on public.primitive_civs;
create trigger trg_pc_chron_stamp
  before update on public.primitive_civs
  for each row execute function public._pc_chron_stamp();
