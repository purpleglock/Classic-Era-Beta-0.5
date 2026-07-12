-- ФИКС 42703 «record "new" has no field "payload"» при загрузке экономики.
-- Причина: _conc_cells_shift (из _concession_build.sql) проверял new.payload
-- в одном boolean-выражении с tg_table_name; Postgres НЕ гарантирует ленивое
-- вычисление and/or, и на строках colony_buildings (где payload нет) падало.
-- Триггеры не пересоздаём — только тело функции. Катить можно в любой момент.
create or replace function public._conc_cells_shift()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_row jsonb; v_conc text; v_col uuid;
begin
  if tg_op = 'INSERT' then v_row := to_jsonb(new); else v_row := to_jsonb(old); end if;
  if tg_table_name = 'colony_buildings' then
    v_conc := nullif(v_row->>'conc','');
  else -- colony_projects
    v_conc := nullif(v_row->'payload'->>'conc','');
  end if;
  v_col := (v_row->>'colony_id')::uuid;
  if v_conc is not null then
    if tg_op = 'INSERT' then
      update public.colonies set cells = coalesce(cells,6) + 1 where id = v_col;
    else
      update public.colonies set cells = greatest(1, coalesce(cells,6) - 1) where id = v_col;
    end if;
  end if;
  if tg_op = 'INSERT' then return new; else return old; end if;
end$$;
