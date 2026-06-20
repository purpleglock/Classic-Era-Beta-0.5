-- ============================================================
-- РЕБАЛАНС ДОКТРИН — архетипы-плейстайлы (зеркало EC_MODS в economy.js).
-- Применять в Supabase → SQL Editor. Идемпотентно (create or replace).
--
-- Что меняется:
--   1) public._faction_mods — новые числа доктрин (бюджет: нетто ≈ 0, потолок ±0.20,
--      идеология ≤0.30 на свою линию с платой). Полы прежние.
--   2) public.economy_claim_system — сигнатура «Экспансионизм»: пул из 2 захватов
--      систем подряд (наравне с роботами / «Домом в небесах»).
-- ============================================================

create or replace function public._faction_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; col numeric:=0; cc numeric:=0; cd numeric:=0; rsch numeric:=0;
  scf int:=0; agf int:=0;   -- плоские: наука ОН/сут, агенты /сут
  rsrch jsonb;              -- изученные технологии (faction_economy.research)
begin
  select * into a from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then
    return jsonb_build_object('gc',1,'mine',1,'build',1,'research',1,'colonize',1,'claim_cost',1,'claim_cd',1,'sci_flat',0,'agents_flat',0);
  end if;

  -- ⚠ Числа = зеркало EC_MODS в economy.js. Менять синхронно.
  case a.gov
    when 'Республика'          then gc:=gc+0.05; scf:=scf+1; agf:=agf-1;
    when 'Монархия'            then gc:=gc+0.15; rsch:=rsch+0.10; cd:=cd+0.10;
    when 'Империя'             then cc:=cc-0.20; cd:=cd-0.15; gc:=gc-0.15; agf:=agf+1;
    when 'Олигархия'           then gc:=gc+0.20; scf:=scf-1; agf:=agf-1;
    when 'Диктатура'           then cd:=cd-0.20; agf:=agf+1; gc:=gc-0.10; scf:=scf-1;
    when 'Теократия'           then gc:=gc+0.10; rsch:=rsch+0.10; agf:=agf+1; scf:=scf-1;
    when 'Технократия'         then gc:=gc-0.20; rsch:=rsch-0.15; bld:=bld+0.05; scf:=scf+2;
    when 'Корпоратократия'     then gc:=gc+0.10; mine:=mine+0.10; agf:=agf-1;
    when 'Коллективный разум'  then mine:=mine+0.20; cc:=cc+0.15; gc:=gc-0.10; scf:=scf+1;
    when 'Машинный разум (ИИ)' then gc:=gc-0.15; bld:=bld-0.10; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.regime
    when 'Демократический'   then gc:=gc+0.15; agf:=agf-1;
    when 'Эгалитарный'       then gc:=gc+0.10; cc:=cc+0.10; scf:=scf+1;
    when 'Меритократический'  then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Плутократический'   then gc:=gc+0.20; scf:=scf-1; agf:=agf-1;
    when 'Олигархический'     then gc:=gc+0.15; mine:=mine-0.10;
    when 'Авторитарный'       then mine:=mine+0.10; agf:=agf+1; gc:=gc-0.10;
    when 'Тоталитарный'       then mine:=mine+0.20; gc:=gc-0.15; agf:=agf+1;
    when 'Деспотичный'        then cd:=cd-0.20; agf:=agf+1; scf:=scf-1;
    when 'Деспотизм'          then mine:=mine+0.15; gc:=gc+0.10; rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Анархический'       then col:=col-0.20; bld:=bld+0.15; gc:=gc-0.15; scf:=scf+1;
    else null;
  end case;

  case a.ideology
    when 'Технократия (Культ науки)' then gc:=gc-0.15; rsch:=rsch-0.20; scf:=scf+2;
    when 'Милитаризм (Культ силы)'   then cc:=cc-0.20; gc:=gc-0.10; rsch:=rsch+0.10; agf:=agf+1;
    when 'Пацифизм'                  then gc:=gc+0.25; cd:=cd+0.15; agf:=agf-1;
    when 'Экспансионизм'             then col:=col-0.25; cc:=cc-0.20; gc:=gc-0.10;
    when 'Изоляционизм'              then gc:=gc+0.15; cc:=cc+0.20; cd:=cd+0.20; agf:=agf+1;
    when 'Ксенофилия'                then gc:=gc+0.20; col:=col-0.10; agf:=agf-1;
    when 'Ксенофобия'                then mine:=mine+0.15; gc:=gc-0.10; agf:=agf+1;
    when 'Спиритуализм'              then gc:=gc+0.10; rsch:=rsch+0.10; scf:=scf-1; agf:=agf+1;
    when 'Трансгуманизм'             then gc:=gc-0.10; rsch:=rsch-0.20; scf:=scf+2;
    when 'Экоцентризм'               then mine:=mine+0.25; gc:=gc-0.15; bld:=bld+0.05;
    when 'Индустриализм'             then bld:=bld-0.15; mine:=mine+0.10; gc:=gc+0.05; rsch:=rsch+0.10;
    else null;
  end case;

  case a.race
    when 'Гуманоиды'                  then gc:=gc+0.05; scf:=scf+1;
    when 'Млекопитающие'              then gc:=gc+0.15;
    when 'Рептилоиды'                 then gc:=gc-0.10; agf:=agf+1;
    when 'Авианы (Птицеподобные)'     then cd:=cd-0.20; gc:=gc-0.05; agf:=agf+1;
    when 'Инсектоиды'                 then mine:=mine+0.15; gc:=gc+0.05; rsch:=rsch+0.10; scf:=scf-1;
    when 'Акватики (Водные)'          then gc:=gc+0.15; col:=col+0.15;
    when 'Плантоиды (Растениевидные)' then mine:=mine+0.15; gc:=gc+0.05; agf:=agf-1;
    when 'Литоиды (Каменные)'         then mine:=mine+0.20; gc:=gc-0.15;
    when 'Синтетики / Киборги'        then gc:=gc-0.35; rsch:=rsch-0.15; scf:=scf+2;  -- все планеты родные → сильный дебаф денег
    when 'Энергетические сущности'    then gc:=gc-0.15; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.civ_type
    when 'frontier' then col:=col-0.20; cd:=cd-0.20; gc:=gc-0.15;
    when 'colony'   then gc:=gc+0.15; mine:=mine+0.10; cc:=cc+0.15; bld:=bld-0.10;
    else null;
  end case;

  -- Лёгкий бонус планеты-столицы (зеркало EC_CAPITAL в economy.js).
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

  -- Бонусы изученных политических технологий (зеркало EC_POLITICS в economy.js).
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

-- ── Сигнатура «Экспансионизм»: пул из 2 захватов систем подряд ──
-- (полная функция = актуальная версия из _security_claim_race.sql + ideology-условие)
create or replace function public.economy_claim_system(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  sys public.map_systems;
  adj boolean;
  cost numeric := 3000;
  cd interval := '4 days';
  mods jsonb;
  max_claims int := 1;     -- размер пула захватов: «Дом в небесах»/роботы/экспансионисты → 2
  pool_used int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  mods := public._faction_mods(app.faction_id);
  cost := round(3000 * (mods->>'claim_cost')::numeric);
  cd := (round(4 * (mods->>'claim_cd')::numeric) || ' days')::interval;

  select * into eco from public.faction_economy where faction_id = app.faction_id for update;
  if not found then raise exception 'no economy'; end if;

  select * into sys from public.map_systems where id = p_system_id;
  if not found then raise exception 'system not found'; end if;
  if sys.faction is not null then raise exception 'system already claimed'; end if;

  select exists (
    select 1 from public.map_hyperlanes h
    join public.map_systems ms
      on ms.id = case when h.a_id = p_system_id then h.b_id
                      when h.b_id = p_system_id then h.a_id end
    where (h.a_id = p_system_id or h.b_id = p_system_id) and ms.faction = app.faction_id
  ) into adj;
  if not adj then raise exception 'system not adjacent to your territory'; end if;

  if eco.gc < cost then raise exception 'not enough GC'; end if;

  -- размер пула захватов: «Дом в небесах» ИЛИ роботы ИЛИ экспансионисты → 2, иначе 1
  if (eco.research is not null and eco.research ? 'pol.house_heavens')
     or public._faction_is_robot(app.faction_id)
     or app.ideology = 'Экспансионизм' then max_claims := 2; end if;

  if eco.last_system_claim is not null and eco.last_system_claim > now() - cd then
    raise exception 'claim cooldown active';
  end if;
  if eco.last_system_claim is not null then pool_used := 0; else pool_used := coalesce(eco.claim_used, 0); end if;
  pool_used := pool_used + 1;

  update public.map_systems set faction = app.faction_id where id = p_system_id and faction is null;
  if not found then raise exception 'system already claimed'; end if;

  if pool_used >= max_claims then
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = now()
      where faction_id = app.faction_id and gc >= cost;
  else
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = null
      where faction_id = app.faction_id and gc >= cost;
  end if;
  if not found then raise exception 'not enough GC'; end if;

  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost);
end$$;
revoke all on function public.economy_claim_system(text) from public;
grant execute on function public.economy_claim_system(text) to authenticated;
