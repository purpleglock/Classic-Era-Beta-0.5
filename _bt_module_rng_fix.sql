-- Импульсные модули падали с «column reference "rng" is ambiguous»:
-- локальная переменная rng совпадает по имени со столбцом battle_units.rng,
-- а в двух запросах (импульс по врагам и импульс по своим) она стоит прямо
-- в WHERE над battle_units. Переименовываем переменную в a_rng.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_module';
  if src is null then raise exception 'нет функции battle_module'; end if;

  if position('a_rng' in src) > 0 then
    raise notice 'battle_module уже пропатчен'; return;
  end if;

  -- прячем строковый литерал 'rng' (ключ в jsonb), чтобы его не задело
  src := replace(src, '''rng''', '@@RNGKEY@@');
  src := regexp_replace(src, '\mrng\M', 'a_rng', 'g');
  src := replace(src, '@@RNGKEY@@', '''rng''');

  execute src;
end$patch$;
