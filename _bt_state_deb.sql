-- © 2025–2026. Все права защищены.
-- battle_state отдаёт дебаффы борта (добор к _bt_modules2.sql). Идемпотентно.
-- Без deb клиент не может объяснить, почему залп бьёт вполсилы, а шаг вдвое
-- дороже: эффект есть, причины на экране нет.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_state'
   order by p.oid limit 1;
  if src is null then raise exception 'battle_state не найдена'; end if;
  if position('''deb'', case when u.side = sd' in src) > 0 then
    raise notice 'дебаффы уже отдаются — пропускаю';
    return;
  end if;
  if position('''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,' in src) = 0 then
    raise exception 'якорь (acts) не найден — сначала _bt_state_acts.sql';
  end if;
  src := replace(src,
    '''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,',
    '''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,
            ''deb'',   coalesce(u.deb, ''{}''::jsonb),
            ''hard'',  u.hard, ''pdb'', u.pdb,
            ''rapid'', u.rapid, ''sammo'', u.sammo,');
  execute src;
end$patch$;
