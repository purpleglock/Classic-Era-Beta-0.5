-- © 2025–2026. Все права защищены.
-- ФИКС: «cannot pass more than 100 arguments to a function».
-- Паспорт борта в battle_state дорос до 51 ключа = 102 аргумента, а у
-- jsonb_build_object предел ровно 100. Бой переставал открываться совсем.
-- Лечим не выкидыванием полей, а разрезом объекта надвое: {…} || {…}.
-- Разрез ставим ПОСЛЕ 'acts' — это же якорь, к которому пристыковывался
-- _bt_state_deb.sql, так что новые поля дальше падают во ВТОРУЮ половину
-- и запас там снова ~90 аргументов. Идемпотентно.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_state'
   order by p.oid limit 1;
  if src is null then raise exception 'battle_state не найдена'; end if;

  if position('|| jsonb_build_object(' in src) > 0 then
    raise notice 'паспорт борта уже разрезан — пропускаю';
    return;
  end if;

  if position('''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,' in src) = 0 then
    raise exception 'якорь (acts) не найден — сначала _bt_state_acts.sql';
  end if;

  src := replace(src,
    '''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,',
    '''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end)
          || jsonb_build_object(');
  execute src;
end$patch$;
