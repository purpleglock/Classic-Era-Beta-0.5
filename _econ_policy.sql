-- ============================================================================
--  КУРС ДЕРЖАВЫ (экономические политики) — метод №4 роста благополучия
--  (см. память wellbeing-growth-methods). 2026-07-24.
--
--  ИДЕЯ (по мотивам торговой политики караванов и политик Stellaris).
--  Держава в любой момент времени держит РОВНО ОДИН экономический курс:
--    · balanced — Сбалансированный: ничего не даёт и ничего не отнимает;
--    · civil    — Гражданский: благополучие и деньги ценой добычи;
--    · war      — Военный: добыча и терпимость к большому флоту ценой благополучия;
--    · ideo     — Идеологический: у КАЖДОЙ идеологии свой, четвёртый вариант;
--    · custom   — Свой курс: игрок сам раскладывает очки по осям (только с техом).
--  Смена курса стоит КУЛДАУН: 10 суток базово, 7 — с «Экономическим советом».
--
--  КУДА БЬЁТ. Всё сделано БЕЗ правки economy_accrue — только суперсеты функций,
--  которые тик уже вызывает:
--    · _faction_mods      — проценты gc/mine/build/research/colonize/claim_* и
--                           плоские sci_flat/agents_flat (курс просто ещё одно
--                           слагаемое рядом с доктриной и политтехами);
--    · _wb_identity       — вклад курса в ИНДЕКС благополучия (wb). Имя функции
--                           («идентичность расы и ПОЛИТИКИ») ровно про это;
--    · _fleet_overcap_pen — военный курс расширяет терпимость к перегрузу флота
--                           (множитель вместимости внутри штрафа).
--  ⚠ ЖЁСТКИЙ лимит флота при постройке живёт в _defense_starbase/_defense_outpost
--    (_fleet_capacity). Эти срезы катятся отдельно, поэтому здесь их НЕ трогаем —
--    курс влияет на штраф благополучия. Когда оборона будет перекачена, туда
--    достаточно домножить результат на public._econ_policy_fleet_mult(p_fid).
--
--  ПОРЯДОК ПРИМЕНЕНИЯ: после _welfare_hub.sql. Перекат economy_accrue НЕ нужен.
--  Идемпотентно (create-or-replace / if not exists / on conflict).
-- ============================================================================

-- ── 1) Хранение курса ────────────────────────────────────────────────────────
alter table public.faction_economy add column if not exists econ_policy text;
alter table public.faction_economy add column if not exists econ_policy_at timestamptz;
alter table public.faction_economy add column if not exists econ_policy_custom jsonb default '{}'::jsonb;

-- ── 2) Технологии: свой курс + укороченный кулдаун ───────────────────────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('pol.econ_council',  60,  '[]'::jsonb),
  ('pol.econ_council2', 130, '["pol.econ_council"]'::jsonb)
on conflict (node_id) do nothing;

-- ── 3) Служебное ─────────────────────────────────────────────────────────────
create or replace function public._econ_policy_key(p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select econ_policy from public.faction_economy where faction_id = p_fid), 'balanced');
$$;
revoke all on function public._econ_policy_key(text) from public;
grant execute on function public._econ_policy_key(text) to authenticated;

-- Кулдаун смены курса в сутках: 10 базово, 7 с «Экономическим советом».
create or replace function public._econ_policy_cd_days(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select case when coalesce((select research from public.faction_economy where faction_id = p_fid), '[]'::jsonb)
                 ? 'pol.econ_council' then 7 else 10 end;
$$;
revoke all on function public._econ_policy_cd_days(text) from public;
grant execute on function public._econ_policy_cd_days(text) to authenticated;

-- Бюджет очков «своего курса»: 3 с советом, 4 с плановым управлением.
create or replace function public._econ_policy_points(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select case
    when coalesce((select research from public.faction_economy where faction_id = p_fid), '[]'::jsonb) ? 'pol.econ_council2' then 4
    when coalesce((select research from public.faction_economy where faction_id = p_fid), '[]'::jsonb) ? 'pol.econ_council'  then 3
    else 0 end;
$$;
revoke all on function public._econ_policy_points(text) from public;
grant execute on function public._econ_policy_points(text) to authenticated;

-- ── 4) ЭФФЕКТЫ КУРСА ─────────────────────────────────────────────────────────
-- Возвращает ДЕЛЬТЫ (не множители!) одним jsonb — их складывают с доктриной.
-- wb — слагаемое индекса благополучия, fleet — множитель вместимости флота.
-- ⚠ Зеркало EC_ECON_POLICY / EC_ECON_POLICY_IDEO / EC_ECON_CUSTOM_STEP в economy.js.
create or replace function public._econ_policy_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  a public.faction_applications; k text; cus jsonb; pts int; used int := 0;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; rsch numeric:=0;
  col numeric:=0; cc numeric:=0; cd numeric:=0;
  scf int:=0; agf int:=0; wb numeric:=0; fl numeric:=1;
  ax text; st int; is_robot boolean := false;
begin
  k := public._econ_policy_key(p_fid);
  select * into a from public.faction_applications
   where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;
  if found then
    is_robot := (a.race = 'Синтетики / Киборги' or a.gov = 'Машинный разум (ИИ)');
  end if;

  if k = 'civil' then
    -- Гражданский: народ живёт лучше и платит налоги, шахты недофинансированы.
    gc := 0.15; wb := 0.05; bld := 0.05; mine := -0.15;

  elsif k = 'war' then
    -- Военный: сырьё и флот в приоритете, уровень жизни проседает.
    mine := 0.15; fl := 1.25; gc := -0.12; wb := -0.06;

  elsif k = 'ideo' then
    -- Четвёртый курс — от идеологии. Робот-набор переопределяет.
    if is_robot then
      bld := -0.15; rsch := -0.10; mine := 0.10; wb := -0.05;
    else
      case coalesce(a.ideology, '')
        when 'Технократия (Культ науки)' then rsch := -0.15; scf := 1;  gc := -0.10;
        when 'Милитаризм (Культ силы)'   then fl := 1.35;    cc := -0.15; wb := -0.10;
        when 'Пацифизм'                  then wb := 0.10;    gc := 0.10;  fl := 0.80;
        when 'Экспансионизм'             then col := -0.20;  cd := -0.15; wb := -0.05;
        when 'Изоляционизм'              then gc := 0.15;    mine := 0.10; col := 0.20;
        when 'Ксенофилия'                then gc := 0.20;    wb := 0.04;  mine := -0.15;
        when 'Ксенофобия'                then mine := 0.20;  fl := 1.15;  gc := -0.15;
        when 'Спиритуализм'              then wb := 0.08;    gc := 0.10;  rsch := 0.10;
        when 'Трансгуманизм'             then rsch := -0.20; wb := 0.04;  gc := -0.15;
        when 'Экоцентризм'               then wb := 0.08;    mine := 0.10; bld := 0.10;
        when 'Индустриализм'             then bld := -0.20;  mine := 0.15; wb := -0.06;
        else null;
      end case;
    end if;

  elsif k = 'custom' then
    -- Свой курс: шаги по осям в пределах ±2, суммарно не дороже бюджета очков.
    -- Отрицательные шаги ВОЗВРАЩАЮТ очки — за счёт них и берутся сильные плюсы.
    pts := public._econ_policy_points(p_fid);
    if pts > 0 then
      select coalesce(econ_policy_custom, '{}'::jsonb) into cus
        from public.faction_economy where faction_id = p_fid;
      for ax in select jsonb_object_keys(coalesce(cus, '{}'::jsonb)) loop
        st := greatest(-2, least(2, coalesce((cus->>ax)::int, 0)));
        used := used + st;      -- плюсы тратят, минусы возвращают
        case ax
          when 'gc'       then gc   := gc   + 0.06 * st;
          when 'mine'     then mine := mine + 0.06 * st;
          when 'build'    then bld  := bld  - 0.06 * st;   -- + = дешевле строить
          when 'research' then rsch := rsch - 0.05 * st;   -- + = дешевле наука
          when 'wb'       then wb   := wb   + 0.03 * st;
          when 'fleet'    then fl   := fl   + 0.10 * st;
          else null;
        end case;
      end loop;
      -- Перебор бюджета = курс не действует вовсе (данные испорчены/устарели).
      if used > pts then
        gc:=0; mine:=0; bld:=0; rsch:=0; col:=0; cc:=0; cd:=0; scf:=0; agf:=0; wb:=0; fl:=1;
      end if;
    end if;
  end if;
  -- 'balanced' и всё неизвестное — нулевой курс.

  return jsonb_build_object(
    'key', k,
    'gc', gc, 'mine', mine, 'build', bld, 'research', rsch,
    'colonize', col, 'claim_cost', cc, 'claim_cd', cd,
    'sci_flat', scf, 'agents_flat', agf,
    'wb', round(wb, 3), 'fleet', round(fl, 3));
end$$;
revoke all on function public._econ_policy_mods(text) from public;
grant execute on function public._econ_policy_mods(text) to authenticated;

-- Отдельный доступ к множителю флота — пригодится обороне при перекате.
create or replace function public._econ_policy_fleet_mult(p_fid text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((public._econ_policy_mods(p_fid)->>'fleet')::numeric, 1);
$$;
revoke all on function public._econ_policy_fleet_mult(text) from public;
grant execute on function public._econ_policy_fleet_mult(text) to authenticated;

-- ── 5) _faction_mods: суперсет _doctrine_rebalance.sql + слагаемое КУРСА ─────
-- ⚠ Тело ниже — полная копия актуальной версии; изменён ТОЛЬКО блок «-- КУРС».
create or replace function public._faction_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; col numeric:=0; cc numeric:=0; cd numeric:=0; rsch numeric:=0;
  scf int:=0; agf int:=0;   -- плоские: наука ОН/сут, агенты /сут
  rsrch jsonb;              -- изученные технологии (faction_economy.research)
  pol jsonb;                -- КУРС: дельты экономического курса державы
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

  -- КУРС ДЕРЖАВЫ (_econ_policy.sql). Guard — если срез не накачен, курса просто нет.
  begin
    pol := public._econ_policy_mods(p_fid);
    gc   := gc   + coalesce((pol->>'gc')::numeric, 0);
    mine := mine + coalesce((pol->>'mine')::numeric, 0);
    bld  := bld  + coalesce((pol->>'build')::numeric, 0);
    rsch := rsch + coalesce((pol->>'research')::numeric, 0);
    col  := col  + coalesce((pol->>'colonize')::numeric, 0);
    cc   := cc   + coalesce((pol->>'claim_cost')::numeric, 0);
    cd   := cd   + coalesce((pol->>'claim_cd')::numeric, 0);
    scf  := scf  + coalesce((pol->>'sci_flat')::int, 0);
    agf  := agf  + coalesce((pol->>'agents_flat')::int, 0);
  exception when undefined_function then null;
  end;

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
grant execute on function public._faction_mods(text) to authenticated;

-- ── 6) _wb_identity: суперсет _wellbeing_armies.sql + вклад КУРСА ────────────
-- Курс складывается с идентичностью ДО общего клампа ±0.20 — курс не может
-- бесконечно накачивать благополучие, он лишь двигает державу внутри вилки.
create or replace function public._wb_identity(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications; w numeric := 0;
begin
  select * into a from public.faction_applications
   where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then return 0; end if;

  w := w + case a.race
    when 'Гуманоиды'                  then 0.03
    when 'Млекопитающие'              then 0.05
    when 'Рептилоиды'                 then -0.02
    when 'Авианы (Птицеподобные)'     then 0.01
    when 'Инсектоиды'                 then -0.03
    when 'Акватики (Водные)'          then 0.04
    when 'Плантоиды (Растениевидные)' then 0.06
    when 'Литоиды (Каменные)'         then -0.04
    when 'Синтетики / Киборги'        then 0.00
    when 'Энергетические сущности'    then 0.02
    else 0 end;

  w := w + case a.gov
    when 'Республика'          then 0.04
    when 'Монархия'            then 0.02
    when 'Империя'             then -0.03
    when 'Олигархия'           then -0.04
    when 'Диктатура'           then -0.05
    when 'Теократия'           then 0.03
    when 'Технократия'         then 0.02
    when 'Корпоратократия'     then -0.02
    when 'Коллективный разум'  then 0.05
    when 'Машинный разум (ИИ)' then 0.00
    else 0 end;

  w := w + case a.regime
    when 'Демократический'   then 0.04
    when 'Эгалитарный'       then 0.06
    when 'Меритократический'  then 0.02
    when 'Плутократический'   then -0.05
    when 'Олигархический'     then -0.03
    when 'Авторитарный'       then -0.03
    when 'Тоталитарный'       then -0.06
    when 'Деспотичный'        then -0.06
    when 'Деспотизм'          then -0.04
    when 'Анархический'       then -0.02
    else 0 end;

  w := w + case a.ideology
    when 'Пацифизм'                  then 0.05
    when 'Ксенофилия'                then 0.03
    when 'Спиритуализм'              then 0.02
    when 'Экоцентризм'               then 0.03
    when 'Милитаризм (Культ силы)'   then -0.04
    when 'Ксенофобия'                then -0.03
    when 'Экспансионизм'             then -0.02
    when 'Изоляционизм'              then 0.01
    when 'Технократия (Культ науки)' then 0.01
    when 'Трансгуманизм'             then 0.02
    when 'Индустриализм'             then -0.01
    else 0 end;

  -- КУРС ДЕРЖАВЫ (_econ_policy.sql). Guard — до наката среза курса просто нет.
  begin
    w := w + coalesce((public._econ_policy_mods(p_fid)->>'wb')::numeric, 0);
  exception when undefined_function then null;
  end;

  return round(greatest(-0.20, least(0.20, w)), 3);
end$$;
revoke all on function public._wb_identity(text) from public;
grant execute on function public._wb_identity(text) to authenticated;

-- ── 7) _fleet_overcap_pen: суперсет + расширение вместимости военным курсом ──
create or replace function public._fleet_overcap_pen(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare used int; cap numeric; over numeric; fl numeric := 1;
begin
  used := public._fleet_used(p_fid);
  cap  := public._fleet_capacity(p_fid);
  begin fl := public._econ_policy_fleet_mult(p_fid); exception when undefined_function then fl := 1; end;
  cap  := cap * greatest(0.5, coalesce(fl, 1));      -- КУРС: военный терпит больший флот
  over := greatest(0, used - cap);
  if over <= 0 then return 0; end if;
  return round(least(0.35, 0.12 * over / greatest(cap, 50)), 3);
end$$;
revoke all on function public._fleet_overcap_pen(text) from public;
grant execute on function public._fleet_overcap_pen(text) to authenticated;

-- ── 8) RPC: сменить курс ─────────────────────────────────────────────────────
-- Кулдаун 10/7 суток; 'custom' требует техa и вписывается в бюджет очков.
create or replace function public.econ_policy_set(p_key text, p_custom jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; eco public.faction_economy; cdd int; pts int; used int := 0;
  ax text; st int; nxt timestamptz; cus jsonb := '{}'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  if p_key not in ('balanced','civil','war','ideo','custom') then raise exception 'bad policy'; end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  cdd := public._econ_policy_cd_days(fid);
  nxt := coalesce(eco.econ_policy_at, to_timestamp(0)) + (cdd || ' days')::interval;
  if now() < nxt and coalesce(eco.econ_policy,'balanced') <> p_key then
    raise exception 'policy cooldown: % days left',
      ceil(extract(epoch from (nxt - now()))/86400.0);
  end if;

  if p_key = 'custom' then
    pts := public._econ_policy_points(fid);
    if pts <= 0 then raise exception 'no econ council tech'; end if;
    for ax in select jsonb_object_keys(coalesce(p_custom, '{}'::jsonb)) loop
      if ax not in ('gc','mine','build','research','wb','fleet') then raise exception 'bad axis: %', ax; end if;
      st := coalesce((p_custom->>ax)::int, 0);
      if st < -2 or st > 2 then raise exception 'axis out of range: %', ax; end if;
      used := used + st;
      cus := cus || jsonb_build_object(ax, st);
    end loop;
    if used > pts then raise exception 'over budget: % of %', used, pts; end if;
  end if;

  update public.faction_economy
     set econ_policy = p_key,
         econ_policy_custom = case when p_key = 'custom' then cus else coalesce(econ_policy_custom,'{}'::jsonb) end,
         econ_policy_at = now()
   where faction_id = fid;

  return jsonb_build_object('ok', true, 'key', p_key,
    'next_change', now() + (cdd || ' days')::interval,
    'mods', public._econ_policy_mods(fid));
end$$;
revoke all on function public.econ_policy_set(text, jsonb) from public;
grant execute on function public.econ_policy_set(text, jsonb) to authenticated;

-- ── 9) RPC: состояние курса для кабинета ────────────────────────────────────
create or replace function public.econ_policy_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; cdd int;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into eco from public.faction_economy where faction_id = fid;
  cdd := public._econ_policy_cd_days(fid);
  return jsonb_build_object(
    'key', coalesce(eco.econ_policy, 'balanced'),
    'custom', coalesce(eco.econ_policy_custom, '{}'::jsonb),
    'changed_at', eco.econ_policy_at,
    'next_change', coalesce(eco.econ_policy_at, to_timestamp(0)) + (cdd || ' days')::interval,
    'cd_days', cdd,
    'points', public._econ_policy_points(fid),
    'mods', public._econ_policy_mods(fid));
end$$;
revoke all on function public.econ_policy_status() from public;
grant execute on function public.econ_policy_status() to authenticated;
