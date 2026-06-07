-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: роботы — все планеты родные + усиленный денежный дебаф
--  Раса «Синтетики / Киборги»:
--    • родные миры = ВСЕ колонизируемые типы планет (без терраформа);
--    • за это денежный дебаф усилен: gc −15% → −35%.
--  (gc-дебаф считается на сервере в _faction_mods, поэтому функцию заменяем.)
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Самодостаточно.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Родные среды расы (зеркало EC_HAB). Синтетики — все колонизируемые типы.
create or replace function public._race_native_envs(p_race text) returns text[] language sql immutable as $$
  select case p_race
    when 'Гуманоиды'                  then array['terrestrial']
    when 'Млекопитающие'              then array['terrestrial','oceanic']
    when 'Рептилоиды'                 then array['desert','volcanic','terrestrial']
    when 'Авианы (Птицеподобные)'     then array['terrestrial','desert']
    when 'Инсектоиды'                 then array['terrestrial','desert','volcanic']
    when 'Акватики (Водные)'          then array['oceanic']
    when 'Плантоиды (Растениевидные)' then array['terrestrial','oceanic']
    when 'Литоиды (Каменные)'         then array['micro','lava','desert']
    when 'Синтетики / Киборги'        then array['terrestrial','oceanic','desert','volcanic','lava','cryo','micro','exotic']
    when 'Энергетические сущности'    then array['exotic','cryo','lava']
    else array['terrestrial'] end
$$;

-- 2. Доктрина: усиленный денежный дебаф у синтетиков (gc −0.35).
create or replace function public._faction_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; col numeric:=0; cc numeric:=0; cd numeric:=0; rsch numeric:=0;
  scf int:=0; agf int:=0;
  rsrch jsonb;
begin
  select * into a from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then
    return jsonb_build_object('gc',1,'mine',1,'build',1,'research',1,'colonize',1,'claim_cost',1,'claim_cd',1,'sci_flat',0,'agents_flat',0);
  end if;

  case a.gov
    when 'Республика'          then gc:=gc+0.10; cd:=cd+0.15; scf:=scf+1;
    when 'Монархия'            then gc:=gc+0.20; scf:=scf-1;
    when 'Империя'             then cc:=cc-0.25; cd:=cd-0.25; gc:=gc-0.10; agf:=agf+1;
    when 'Олигархия'           then gc:=gc+0.25; scf:=scf-1;
    when 'Диктатура'           then cd:=cd-0.20; gc:=gc-0.10; agf:=agf+1;
    when 'Теократия'           then gc:=gc+0.10; rsch:=rsch+0.15; scf:=scf-2; agf:=agf+1;
    when 'Технократия'         then gc:=gc-0.15; bld:=bld+0.10; rsch:=rsch-0.25; scf:=scf+3;
    when 'Корпоратократия'     then gc:=gc+0.20; mine:=mine+0.15; bld:=bld-0.10; agf:=agf-1;
    when 'Коллективный разум'  then mine:=mine+0.15; cc:=cc+0.20; rsch:=rsch-0.10; scf:=scf+1;
    when 'Машинный разум (ИИ)' then gc:=gc-0.15; bld:=bld-0.10; rsch:=rsch-0.15; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.regime
    when 'Демократический'   then gc:=gc+0.15; agf:=agf-1;
    when 'Эгалитарный'       then gc:=gc+0.10; cc:=cc+0.10; scf:=scf+1;
    when 'Меритократический'  then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Плутократический'   then gc:=gc+0.25; scf:=scf-1;
    when 'Олигархический'     then gc:=gc+0.15; mine:=mine-0.10;
    when 'Авторитарный'       then mine:=mine+0.10; gc:=gc-0.10; agf:=agf+1;
    when 'Тоталитарный'       then mine:=mine+0.25; gc:=gc-0.15; agf:=agf+1;
    when 'Деспотичный'        then cd:=cd-0.20; scf:=scf-1; agf:=agf+1;
    when 'Деспотизм'          then gc:=gc+0.15; mine:=mine+0.10; rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Анархический'       then col:=col-0.25; gc:=gc-0.20; bld:=bld+0.15; scf:=scf+1;
    else null;
  end case;

  case a.ideology
    when 'Технократия (Культ науки)' then gc:=gc-0.15; rsch:=rsch-0.25; scf:=scf+3;
    when 'Милитаризм (Культ силы)'   then cc:=cc-0.15; gc:=gc-0.10; rsch:=rsch+0.10; agf:=agf+1;
    when 'Пацифизм'                  then gc:=gc+0.25; agf:=agf-1;
    when 'Экспансионизм'             then col:=col-0.30; cc:=cc-0.30; cd:=cd-0.40; gc:=gc-0.10;
    when 'Изоляционизм'              then gc:=gc+0.15; cc:=cc+0.25; cd:=cd+0.25; scf:=scf+1;
    when 'Ксенофилия'                then gc:=gc+0.20; agf:=agf-1;
    when 'Ксенофобия'                then mine:=mine+0.10; gc:=gc-0.20; agf:=agf+1;
    when 'Спиритуализм'              then rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Трансгуманизм'             then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Экоцентризм'               then mine:=mine+0.30; gc:=gc-0.20;
    when 'Индустриализм'             then gc:=gc+0.25; mine:=mine+0.10; bld:=bld-0.15; rsch:=rsch+0.10; scf:=scf-1;
    else null;
  end case;

  case a.race
    when 'Гуманоиды'                  then gc:=gc+0.05; scf:=scf+1;
    when 'Млекопитающие'              then gc:=gc+0.20;
    when 'Рептилоиды'                 then gc:=gc-0.10; agf:=agf+1;
    when 'Авианы (Птицеподобные)'     then cd:=cd-0.25; gc:=gc-0.05; agf:=agf+1;
    when 'Инсектоиды'                 then mine:=mine+0.20; gc:=gc+0.10; rsch:=rsch+0.10; scf:=scf-1;
    when 'Акватики (Водные)'          then gc:=gc+0.15; col:=col+0.15;
    when 'Плантоиды (Растениевидные)' then mine:=mine+0.15; gc:=gc+0.10; agf:=agf-1;
    when 'Литоиды (Каменные)'         then mine:=mine+0.25; gc:=gc-0.15;
    when 'Синтетики / Киборги'        then gc:=gc-0.35; rsch:=rsch-0.15; scf:=scf+2;  -- все планеты родные → сильный дебаф денег
    when 'Энергетические сущности'    then gc:=gc-0.15; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.civ_type
    when 'frontier' then col:=col-0.25; cd:=cd-0.25; gc:=gc-0.15;
    when 'colony'   then gc:=gc+0.20; mine:=mine+0.10; cc:=cc+0.15; bld:=bld-0.10;
    else null;
  end case;

  case a.capital_env
    when 'terrestrial' then gc:=gc+0.05;
    when 'oceanic'     then col:=col-0.10;
    when 'desert'      then mine:=mine+0.10;
    when 'volcanic'    then mine:=mine+0.10;
    when 'lava'        then mine:=mine+0.12;
    when 'cryo'        then rsch:=rsch-0.08;
    when 'micro'       then cd:=cd-0.12;
    when 'exotic'      then scf:=scf+1;
    else null;
  end case;

  select research into rsrch from public.faction_economy where faction_id=p_fid;
  if rsrch is not null then
    if rsrch ? 'pol.new_deal'    then gc:=gc+0.10; end if;
    if rsrch ? 'pol.mercantile'  then gc:=gc+0.10; bld:=bld-0.05; end if;
    if rsrch ? 'pol.five_year'   then bld:=bld-0.15; end if;
    if rsrch ? 'pol.goelro'      then mine:=mine+0.15; end if;
    if rsrch ? 'pol.land_reform' then col:=col-0.15; end if;
    if rsrch ? 'pol.total_mob'   then cc:=cc-0.20; end if;
  end if;

  return jsonb_build_object(
    'gc',          greatest(0.3,  1+gc),
    'mine',        greatest(0.3,  1+mine),
    'build',       greatest(0.3,  1+bld),
    'research',    greatest(0.3,  1+rsch),
    'colonize',    greatest(0.3,  1+col),
    'claim_cost',  greatest(0.3,  1+cc),
    'claim_cd',    greatest(0.25, 1+cd),
    'sci_flat',    scf,
    'agents_flat', agf);
end$$;
revoke all on function public._faction_mods(text) from public;
