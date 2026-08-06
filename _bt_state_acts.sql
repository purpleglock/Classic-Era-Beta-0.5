-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- battle_state отдаёт активное снаряжение борта  (добор к _bt_modules.sql)
-- ════════════════════════════════════════════════════════════
-- Панель «Снаряжение» рисуется по acts/mcd — без них клиент про модули не знает.
-- Правим ТЕКСТОМ, а не перевыпуском: battle_state собран несколькими накатами
-- (захват целей, интердикция, пул времени), переписать её целиком = потерять их.
-- Идемпотентно: повторный прогон ничего не делает.
--
-- Своё снаряжение видно только своей стороне — как и wpn. Иначе панель врага
-- стала бы разведданными: «у него прыжок на кулдауне, можно не бояться обхода».
-- ════════════════════════════════════════════════════════════
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_state'
   order by p.oid limit 1;
  if src is null then raise exception 'battle_state не найдена'; end if;
  if position('''acts'', case when u.side = sd' in src) > 0 then
    raise notice 'снаряжение уже отдаётся — пропускаю';
    return;
  end if;
  if position('''wpn'', case when u.side = sd then coalesce(u.wpn, ''[]''::jsonb) else null end,' in src) = 0 then
    raise exception 'якорь (wpn) в battle_state не найден — правка НЕ применена';
  end if;
  src := replace(src,
    '''wpn'', case when u.side = sd then coalesce(u.wpn, ''[]''::jsonb) else null end,',
    '''wpn'', case when u.side = sd then coalesce(u.wpn, ''[]''::jsonb) else null end,
            ''acts'', case when u.side = sd then coalesce(u.acts, ''[]''::jsonb) else null end,
            ''mcd'',  case when u.side = sd then coalesce(u.mcd, ''{}''::jsonb) else null end,
            ''amp'',  case when u.side = sd then u.amp else null end,');
  execute src;
end$patch$;

-- ПРОВЕРКА: battle_state(bid)->'units'->0 содержит acts/mcd у своих бортов
-- и не содержит (null) у чужих.
