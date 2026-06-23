-- ============================================================
-- ДОСТИЖЕНИЯ ФРАКЦИИ (ачивки) — в стиле стоицизма
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Награда (ГС) и сам факт получения считаются ТОЛЬКО на сервере:
--   RPC ach_check() пересчитывает условия из реальных таблиц, выдаёт
--   новые ачивки (on conflict do nothing — без двойной выдачи) и
--   начисляет ГС. Клиент не может вписать ачивку или начислить себе ГС
--   напрямую — закрываем дыру прямой записи (см. memory: client-write RLS hole).
--
-- Каталог (id / условие / награда) — зеркало EC_ACH в economy.js.
-- Видны ачивки только во вкладке «Обзор» кабинета (ecAchPanel).
-- ============================================================

-- ── Таблица выданных ачивок ─────────────────────────────────
create table if not exists public.faction_achievements (
  faction_id text        not null,
  ach_id     text        not null,
  reward     int         not null default 0,   -- сколько ГС начислено при выдаче
  earned_at  timestamptz not null default now(),
  primary key (faction_id, ach_id)
);

alter table public.faction_achievements enable row level security;

-- Читать может только владелец своей фракции (для прямого dbGet, если понадобится).
-- Запись/удаление — НЕ разрешены никому (нет политик) → только SECURITY DEFINER RPC.
drop policy if exists fa_select_own on public.faction_achievements;
create policy fa_select_own on public.faction_achievements
  for select using (
    exists (select 1 from public.faction_economy fe
            where fe.faction_id = faction_achievements.faction_id
              and fe.owner_id   = auth.uid())
  );

revoke insert, update, delete on public.faction_achievements from anon, authenticated;
grant  select on public.faction_achievements to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: проверка и выдача ачивок
--   Вызывается клиентом при заходе в кабинет (ecLoad).
--   Возвращает { newly, gc, new_ids[], earned[{id,reward,earned_at}] }.
-- ════════════════════════════════════════════════════════════
create or replace function public.ach_check()
returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
-- ↑ КРИТИЧНО: у diplo_members колонка зовётся `fid` и сталкивается с переменной fid
--   в `where dm.fid = fid` → ошибка 42702 ambiguous рушила ВЕСЬ пересчёт (и выдачу
--   всех новых ачивок) после применения _diplo_unions.sql. Директива велит PL/pgSQL
--   при конфликте имени трактовать его как ПЕРЕМЕННУЮ (колонки берём только явным dm.fid).
declare
  fid text;
  v_research  int;
  v_gc        numeric;
  v_science   numeric;
  v_buildings int;
  v_colonies  int;
  v_attacked  boolean;
  v_route     boolean;
  v_raid      boolean;
  v_spy       boolean;
  v_loan      boolean;
  -- ── расширенный набор (масштаб / вера / дипломатия / война / шпионаж / торговля) ──
  v_resmax    numeric;   -- максимальный запас одного ресурса
  v_terraform boolean;   -- терраформирована ли хоть одна планета
  v_routes    int;       -- активных торговых путей (моих)
  v_units     int;       -- спроектировано юнитов
  v_raids     int;       -- успешных рейдов
  v_spies     int;       -- успешных разведопераций
  v_recog     int;       -- сколько держав признали мою веру
  v_techsell  boolean;   -- продал технологию на рынке
  v_faith_found boolean; -- основал веру
  v_sect      boolean;   -- внедрил тайную секту
  v_faith_mem boolean;   -- исповедую веру
  v_union_mem boolean;   -- состою в союзе
  v_union_lead boolean;  -- возглавляю союз
  v_vassal_lord boolean; -- имею вассала
  v_loan_big  boolean;   -- выдал крупный заём
  v_news      boolean;   -- опубликовал новость
  -- ── третий набор (инфраструктура / оборона / тонкая дипломатия / познание) ──
  v_tnp       numeric;   -- товары народного потребления в казне
  v_slots2    int;       -- активных исследований одновременно
  v_queue3    int;       -- длина очереди исследований
  v_b_shipyard boolean;  -- есть верфь
  v_b_intel   boolean;   -- есть разведцентр
  v_full_slots boolean;  -- постройка с раскрытыми 6 слотами
  v_res_kinds int;       -- сколько разных ресурсов в запасе
  v_unit_cats int;       -- сколько разных родов войск спроектировано
  v_ci        boolean;   -- раскрыл вражеского шпиона
  v_barter    boolean;   -- заключил бартерную сделку
  v_tech_buy  boolean;   -- купил технологию на рынке
  v_vassal_self boolean; -- сам стал вассалом
  v_amicitia  boolean;   -- прочные дружеские отношения
  v_debt_paid boolean;   -- погасил взятый заём
  -- ── четвёртый набор (гранд-тиры / охват / мета-капстоун) ──
  v_terraform_n int;     -- сколько планет терраформировано
  v_sects     int;       -- внедрено сект
  v_vassal_n  int;       -- число действующих вассалов
  v_loans_n   int;       -- выдано займов
  v_btypes    int;       -- разных отраслей (типов построек)
  v_systems   int;       -- в скольких системах есть колонии
  v_enemy     boolean;   -- есть заклятый враг
  v_lead_big  boolean;   -- возглавляю крупный союз (5+ членов)
  v_ach_count int;       -- сколько ачивок уже заработано (для мета-капстоуна)
  -- ── пятый набор (военка: техи классов + реальное производство) ──
  v_cruiser    boolean;  -- открыт класс «Крейсер» (cls.ship.cruiser в research)
  v_dread_tech boolean;  -- открыт класс «Дредноут» (cls.ship.dreadnought)
  v_corv       int;      -- построено корветов (производство × класс дизайна)
  v_dread_built boolean; -- построен хотя бы один дредноут
  v_ships_built int;     -- построено кораблей всего
  v_ground_built int;    -- построено наземной техники
  v_avia_built  int;     -- построено авиации
  v_kfzlib    boolean;   -- пасхалка: есть колония с именем «Kfzlib»
  -- ── шестой набор (колонии-станции Небожителей: требуют исследований cel.* + особая «Храм мироздания») ──
  v_giant     boolean;   -- есть колония-станция на газовом/ледяном/горячем гиганте (нужна pol.cel_giants)
  v_anomaly_col boolean; -- есть колония-станция в космической аномалии (нужна pol.cel_anomaly)
  v_temple_sanctuary boolean; -- возведён Храм Веры в системе «Храм мироздания»
  -- ── седьмой набор (УРОН ТАЙНЫХ ОПЕРАЦИЙ: накопительные итоги по spy_missions) ──
  v_steal_gc   numeric;  -- суммарно украдено чужой казны (op=steal_gc)
  v_steal_res  numeric;  -- суммарно украдено чужого сырья (op=steal_res)
  v_destroyed  int;      -- уничтожено чужих построек (saboteur+mass_demolish)
  v_killed     int;      -- ликвидировано вражеских агентов (op=kill_agent)
  v_techstolen int;      -- украдено чужих технологий (op=steal_tech)
  -- ── восьмой набор (контрразведка-мини-игра + именные корабли + дивизии) ──
  v_caught     int;      -- раскрыто чужих шпионов (spy_missions detected=true; вкл. мини-игру spy_investigate)
  v_div_built  int;      -- сформировано дивизий (производство category='division')
  v_named_bs   boolean;  -- создан линкор (battleship) с именем «Брандтаухер»
  v_named_cr   boolean;  -- создан крейсер (cruiser) с именем «Беликоза»
  -- ── девятый набор (лор-системы: судный день над «Храмом Мироздания» + аванпост у «Конца гиперпути») ──
  v_doom_temple   boolean;  -- ВСЕ уничтожимые планеты системы «Храм мироздания» стёрты МОИМ судным орудием
  v_outpost_edge  boolean;  -- развёрнут мой аванпост в системе «Конец гиперпути»
  v_temple_pl     int;      -- всего уничтожимых планет в «Храме мироздания»
  v_temple_doomed int;      -- из них стёрто моим орудием (doomed_by=fid)
  v_doom_kill     boolean;  -- уничтожил хоть одну планету орудием судного дня
  v_worldkiller   boolean;  -- стёр колонию ДРУГОГО игрока (doom_salvos.victim_fid)
  v_outposts_n    int;      -- развёрнуто моих аванпостов (по галактике)
  v_corp          boolean;  -- учредил корпорацию (организацию) на бирже
  rec         record;
  newly       int := 0;
  new_ids     jsonb := '[]'::jsonb;
  v_err       text  := null;     -- ДИАГ: текст пойманной ошибки пересчёта (для отладки)
begin
  fid := public._ec_my_fid();   -- своя одобренная фракция (+ проверка бана)

  -- ════════════════════════════════════════════════════════════
  -- ЗАЩИТА ОТ РЕГРЕССА «0/N»: весь пересчёт и выдача — best-effort.
  -- Если что-то падает (нет таблицы фичи, кривой ресурс, новая колонка и т.п.)
  -- — гасим ошибку и ВСЁ РАВНО отдаём уже заработанные ачивки в return ниже.
  -- Иначе одна ошибка обнуляла бы всю панель достижений.
  -- ════════════════════════════════════════════════════════════
  begin

  -- ════════════════════════════════════════════════════════════
  -- УСТОЙЧИВОСТЬ: каждая необязательная фича (вера, дипломатия, рейды,
  -- конструктор, рынок и т.п.) живёт в своей миграции. Если таблицы/колонки
  -- ещё нет в этой базе — НЕ валим всю функцию (иначе пропадут ВСЕ ачивки),
  -- а просто оставляем соответствующую ачивку невыполненной (to_regclass-гард).
  -- ════════════════════════════════════════════════════════════
  -- Безопасные дефолты (если фича отсутствует — значение остаётся таким).
  v_research:=0; v_gc:=0; v_science:=0; v_tnp:=0; v_slots2:=0; v_queue3:=0;
  v_buildings:=0; v_colonies:=0; v_resmax:=0; v_res_kinds:=0; v_routes:=0;
  v_units:=0; v_unit_cats:=0; v_raids:=0; v_spies:=0; v_recog:=0; v_sects:=0;
  v_vassal_n:=0; v_loans_n:=0; v_btypes:=0; v_systems:=0; v_terraform_n:=0;
  v_ach_count:=0; v_corv:=0; v_ships_built:=0; v_ground_built:=0; v_avia_built:=0;
  v_terraform:=false; v_techsell:=false; v_faith_found:=false; v_sect:=false;
  v_faith_mem:=false; v_union_mem:=false; v_union_lead:=false; v_vassal_lord:=false;
  v_loan_big:=false; v_news:=false; v_b_shipyard:=false; v_b_intel:=false;
  v_full_slots:=false; v_ci:=false; v_barter:=false; v_tech_buy:=false;
  v_vassal_self:=false; v_amicitia:=false; v_debt_paid:=false; v_enemy:=false;
  v_lead_big:=false; v_cruiser:=false; v_dread_tech:=false; v_dread_built:=false;
  v_attacked:=false; v_route:=false; v_raid:=false; v_spy:=false; v_loan:=false;
  v_kfzlib:=false;
  v_giant:=false; v_anomaly_col:=false; v_temple_sanctuary:=false;
  v_steal_gc:=0; v_steal_res:=0; v_destroyed:=0; v_killed:=0; v_techstolen:=0;
  v_caught:=0; v_div_built:=0; v_named_bs:=false; v_named_cr:=false;
  v_doom_temple:=false; v_outpost_edge:=false; v_temple_pl:=0; v_temple_doomed:=0;
  v_doom_kill:=false; v_worldkiller:=false; v_outposts_n:=0; v_corp:=false;

  -- ── Казна (gc/science/tnp/research — базовые). research_slots/queue из
  --    _research_queue.sql: если миграции нет, ловим undefined_column ──
  select coalesce(jsonb_array_length(coalesce(research,'[]'::jsonb)),0),
         coalesce(gc,0), coalesce(science,0), coalesce(tnp,0)
    into v_research, v_gc, v_science, v_tnp
    from public.faction_economy where faction_id = fid;
  v_research:=coalesce(v_research,0); v_gc:=coalesce(v_gc,0);
  v_science:=coalesce(v_science,0); v_tnp:=coalesce(v_tnp,0);
  begin
    select coalesce(jsonb_array_length(coalesce(research_slots,'[]'::jsonb)),0),
           coalesce(jsonb_array_length(coalesce(research_queue,'[]'::jsonb)),0)
      into v_slots2, v_queue3
      from public.faction_economy where faction_id = fid;
  exception when undefined_column then v_slots2:=0; v_queue3:=0; end;
  v_slots2:=coalesce(v_slots2,0); v_queue3:=coalesce(v_queue3,0);

  -- ── Колонии и постройки (базовые таблицы _economy_setup) ──
  select count(*) into v_buildings from public.colony_buildings where faction_id = fid;
  select count(*) into v_colonies  from public.colonies         where faction_id = fid;
  -- resources = jsonb {имя: число}; на всякий случай ограждаем приведение к numeric
  -- (нечисловое значение/нестандартная структура не должны рушить весь пересчёт).
  begin
    select coalesce(max((val)::numeric),0) into v_resmax
      from public.faction_economy fe, jsonb_each_text(coalesce(fe.resources,'{}'::jsonb)) as r(key,val)
     where fe.faction_id = fid and val ~ '^-?[0-9.]+$';
  exception when others then v_resmax := 0; end;
  begin
    select count(*) into v_res_kinds
      from public.faction_economy fe, jsonb_each_text(coalesce(fe.resources,'{}'::jsonb)) as r(key,val)
     where fe.faction_id = fid and val ~ '^-?[0-9.]+$' and (val)::numeric > 0;
  exception when others then v_res_kinds := 0; end;
  v_terraform := exists(select 1 from public.colonies where faction_id=fid and terraformed=true);
  select count(*) into v_terraform_n from public.colonies where faction_id=fid and terraformed=true;
  select count(distinct system_id) into v_systems from public.colonies where faction_id=fid and system_id is not null;
  -- Пасхалка: любая колония, переименованная в «Kfzlib» (без регистра/пробелов).
  v_kfzlib := exists(select 1 from public.colonies where faction_id=fid and lower(btrim(planet_name))='kfzlib');
  v_b_shipyard := exists(select 1 from public.colony_buildings where faction_id=fid and btype='shipyard');
  v_b_intel    := exists(select 1 from public.colony_buildings where faction_id=fid and btype='intel');
  v_full_slots := exists(select 1 from public.colony_buildings where faction_id=fid and coalesce(slots_open,1)>=6);
  select count(distinct btype) into v_btypes from public.colony_buildings where faction_id=fid;

  -- ── Колонии-станции Небожителей (требуют исследований pol.cel_*) ──
  --   На непригодных мирах обычная колония невозможна — только станция, а её
  --   постройка открывается технологией. Группу определяем из сохранённого
  --   type/name колонии (зеркало _ec_group_of без kind): гиганты — по категории
  --   type, аномалии — по имени планеты. _ec_name_group живёт в _fix_station_belt.sql,
  --   поэтому весь блок best-effort (нет функции → ачивки просто не выполнены).
  begin
    v_giant := exists(
      select 1 from public.colonies c
       where c.faction_id = fid
         and public._ec_planet_group(c.planet_type) in ('gasgiant','icegiant','hotgiant'));
    v_anomaly_col := exists(
      select 1 from public.colonies c
       where c.faction_id = fid
         and (public._ec_planet_group(c.planet_type) = 'anomaly'
              or public._ec_name_group(c.planet_type) = 'anomaly'
              or public._ec_name_group(c.planet_name) = 'anomaly'));
  exception when others then v_giant:=false; v_anomaly_col:=false; end;

  -- ── Особая: Храм Веры в системе «Храм мироздания» ──
  --   map_systems — карта (название системы); колония матчится по system_id,
  --   храм — colony_buildings.btype='temple'.
  begin
    if to_regclass('public.map_systems') is not null then
      v_temple_sanctuary := exists(
        select 1 from public.colony_buildings cb
          join public.colonies   c  on c.id = cb.colony_id
          join public.map_systems ms on ms.id = c.system_id
         where cb.faction_id = fid and cb.btype = 'temple'
           and lower(btrim(ms.name)) = 'храм мироздания');
    end if;
  exception when others then v_temple_sanctuary:=false; end;

  -- ── Лор-достижение «Надежда не вернётся»: в системе «Храм мироздания»
  --   ВСЕ уничтожимые планеты стёрты МОИМ орудием судного дня. _doom_resolve
  --   (_interstellar_artillery.sql) помечает поражённую планету doomed_by=fid.
  --   «Уничтожимые» = тела-планеты: kind='planet' ИЛИ без поля kind (столичные
  --   планеты в _ensure_capital пишутся без kind); пояса/аномалии исключены. ──
  begin
    if to_regclass('public.map_systems') is not null then
      select count(*) filter (where coalesce(b.val->>'kind','planet')='planet'),
             count(*) filter (where coalesce(b.val->>'kind','planet')='planet'
                                and (b.val->>'doomed_by') = fid)
        into v_temple_pl, v_temple_doomed
        from public.map_systems ms
        cross join lateral jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as b(val)
       where lower(btrim(ms.name)) = 'храм мироздания';
      v_doom_temple := coalesce(v_temple_pl,0) > 0 and v_temple_pl = v_temple_doomed;
    end if;
  exception when others then v_doom_temple:=false; end;

  -- ── Орудие судного дня: разрешившиеся залпы (_interstellar_artillery.sql).
  --   status='done' = снаряд приземлился и стёр планету (intercepted — отдельно);
  --   victim_fid (заполняет _doom_resolve) = держава, чью колонию снёс залп. ──
  begin
    if to_regclass('public.doom_salvos') is not null then
      v_doom_kill := exists(
        select 1 from public.doom_salvos where faction_id=fid and status='done');
      v_worldkiller := exists(
        select 1 from public.doom_salvos
         where faction_id=fid and victim_fid is not null and victim_fid <> fid);
    end if;
  exception when others then v_doom_kill:=false; v_worldkiller:=false; end;

  -- ── Аванпосты (public.outposts из _defense_outpost.sql): лор-система «Конец
  --   гиперпути» + общее число развёрнутых по галактике. ──
  begin
    if to_regclass('public.outposts') is not null then
      select count(*) into v_outposts_n from public.outposts where faction_id=fid;
      if to_regclass('public.map_systems') is not null then
        v_outpost_edge := exists(
          select 1 from public.outposts o
            join public.map_systems ms on ms.id = o.system_id
           where o.faction_id = fid and lower(btrim(ms.name)) = 'конец гиперпути');
      end if;
    end if;
  exception when others then v_outpost_edge:=false; v_outposts_n:=0; end;

  -- ── Биржа: учреждена корпорация (организация) — _exchange_corps.sql ──
  begin
    if to_regclass('public.corporations') is not null then
      v_corp := exists(select 1 from public.corporations where faction_id=fid);
    end if;
  exception when others then v_corp:=false; end;

  -- ── Торговля / шпионаж / займы (базовые таблицы _economy_setup) ──
  select count(*) into v_routes from public.trade_routes where (a_fid=fid or b_fid=fid) and status='active';
  v_route := v_routes > 0;
  select count(*) into v_spies from public.spy_missions where actor_fid=fid and outcome='success';
  v_spy   := v_spies > 0;
  v_ci    := exists(select 1 from public.spy_missions where target_fid=fid and detected=true);
  -- Раскрытые чужие шпионы: detected=true ставится и при пассивном засвете, и
  -- мини-игрой расследования spy_investigate (улики→100% → detected=true).
  select count(*) into v_caught from public.spy_missions where target_fid=fid and detected=true;
  v_attacked := exists(select 1 from public.spy_missions where target_fid=fid);
  -- ── Накопительный урон тайных операций (_spy_new_ops.sql; result jsonb).
  --    Если новых операций нет/не применены — итоги остаются 0, ачивки не выполнены. ──
  select coalesce(sum((result->>'gc')::numeric),0) into v_steal_gc
    from public.spy_missions where actor_fid=fid and op='steal_gc' and outcome='success';
  select coalesce(sum((result->>'amount')::numeric),0) into v_steal_res
    from public.spy_missions where actor_fid=fid and op='steal_res' and outcome='success';
  -- saboteur уничтожает 1 здание (result.building не null), mass_demolish — result.count
  select coalesce(sum(case
      when op='sabotage'      and (result->>'building') is not null then 1
      when op='mass_demolish' then coalesce((result->>'count')::int,0)
      else 0 end),0) into v_destroyed
    from public.spy_missions where actor_fid=fid and op in ('sabotage','mass_demolish') and outcome='success';
  select count(*) into v_killed     from public.spy_missions where actor_fid=fid and op='kill_agent' and outcome='success';
  select count(*) into v_techstolen from public.spy_missions where actor_fid=fid and op='steal_tech' and outcome='success';
  v_loan     := exists(select 1 from public.loans where lender_fid=fid);
  v_loan_big := exists(select 1 from public.loans where lender_fid=fid and coalesce(amount,0)>=20000);
  v_debt_paid:= exists(select 1 from public.loans where borrower_fid=fid and status='repaid');
  select count(*) into v_loans_n from public.loans where lender_fid=fid;

  -- ── Производство юнитов (unit_production базовая) ──
  select coalesce(sum(qty),0) into v_ships_built  from public.unit_production where faction_id=fid and status='done' and category='ship';
  -- ВАЖНО: производятся ТОЛЬКО ship и division (см. _unit_resources.sql/produce:
  -- ground/aviation существуют лишь как компоненты дивизий, отдельно не строятся →
  -- наземные/авиа достижения считаем по СФОРМИРОВАННЫМ ДИВИЗИЯМ, а не по «единицам».
  select coalesce(sum(qty),0) into v_div_built    from public.unit_production where faction_id=fid and status='done' and category='division';
  -- v_ground_built/v_avia_built больше не используются в каталоге (категории не производятся),
  -- но оставлены вычисленными на случай возврата прямого производства техники.
  select coalesce(sum(qty),0) into v_ground_built from public.unit_production where faction_id=fid and status='done' and category='ground';
  select coalesce(sum(qty),0) into v_avia_built   from public.unit_production where faction_id=fid and status='done' and category='aviation';

  -- ── Рейды — _raid_setup.sql (опц.) ──
  if to_regclass('public.raid_missions') is not null then
    select count(*) into v_raids from public.raid_missions
     where actor_fid=fid and status='done'
       and (coalesce((outcome->>'loot_units')::numeric,0)>0 or coalesce((outcome->>'loot_gc')::numeric,0)>0);
    v_raid := v_raids > 0;
  end if;

  -- ── Конструктор/юниты — _units_setup.sql (опц.); классы кораблей из research ──
  if to_regclass('public.faction_units') is not null then
    select count(*) into v_units from public.faction_units where faction_id=fid;
    select count(distinct category) into v_unit_cats from public.faction_units
      where faction_id=fid and category in ('ship','ground','aviation','division');
    v_cruiser    := exists(select 1 from public.faction_economy where faction_id=fid and research @> '"cls.ship.cruiser"'::jsonb);
    v_dread_tech := exists(select 1 from public.faction_economy where faction_id=fid and research @> '"cls.ship.dreadnought"'::jsonb);
    select coalesce(sum(up.qty),0) into v_corv
      from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
     where up.faction_id=fid and up.status='done' and fu.data->>'class'='corvette';
    v_dread_built := exists(select 1 from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
       where up.faction_id=fid and up.status='done' and fu.data->>'class'='dreadnought');
    -- Именные корабли: имя дизайна хранится в ВЕРХНЕМ регистре (constructors.js),
    -- класс корпуса — в data->>'class'. Допускаем серийный суффикс «-2/-3…» (like '…%').
    v_named_bs := exists(select 1 from public.faction_units
       where faction_id=fid and category='ship' and data->>'class'='battleship'
         and lower(coalesce(name,'')) like 'брандтаухер%');
    v_named_cr := exists(select 1 from public.faction_units
       where faction_id=fid and category='ship' and data->>'class'='cruiser'
         and (lower(coalesce(name,'')) like 'беликоза%' or lower(coalesce(name,'')) like 'беликорза%'));
  end if;

  -- ── Рынок технологий — _migration_tech_market.sql (опц.) ──
  if to_regclass('public.tech_offers') is not null then
    v_techsell := exists(select 1 from public.tech_offers where seller_fid=fid and status='accepted');
    v_tech_buy := exists(select 1 from public.tech_offers where buyer_fid=fid and status='accepted');
  end if;

  -- ── Бартер — _migration_trade_barter.sql (опц.) ──
  if to_regclass('public.barter_offers') is not null then
    v_barter := exists(select 1 from public.barter_offers where (from_fid=fid or to_fid=fid) and status='accepted');
  end if;

  -- ── Новости — _faction_news.sql (опц.) ──
  if to_regclass('public.faction_news') is not null then
    v_news := exists(select 1 from public.faction_news where faction_id=fid and status='approved');
  end if;

  -- ── Вера — _faith_*.sql (опц.) ──
  if to_regclass('public.faiths') is not null then
    v_faith_found := exists(select 1 from public.faiths where founder_fid=fid);
  end if;
  if to_regclass('public.faith_membership') is not null then
    v_faith_mem := exists(select 1 from public.faith_membership where faction_id=fid);
  end if;
  if to_regclass('public.faith_offers') is not null then
    select count(*) into v_recog from public.faith_offers where from_fid=fid and status='accepted';
  end if;
  if to_regclass('public.faith_sects') is not null then
    v_sect := exists(select 1 from public.faith_sects where owner_fid=fid);
    select count(*) into v_sects from public.faith_sects where owner_fid=fid;
  end if;

  -- ── Дипломатия (союзы/вассалы) — _diplo_unions.sql (опц.) ──
  if to_regclass('public.diplo_members') is not null then
    v_union_mem := exists(select 1 from public.diplo_members dm where dm.fid=fid);
  end if;
  if to_regclass('public.diplo_unions') is not null then
    v_union_lead := exists(select 1 from public.diplo_unions where leader_fid=fid);
    if to_regclass('public.diplo_members') is not null then
      v_lead_big := exists(select 1 from public.diplo_unions u
        join public.diplo_members m on m.union_id=u.id
        where u.leader_fid=fid group by u.id having count(*)>=5);
    end if;
  end if;
  if to_regclass('public.diplo_vassals') is not null then
    v_vassal_lord := exists(select 1 from public.diplo_vassals where overlord_fid=fid and status='active');
    v_vassal_self := exists(select 1 from public.diplo_vassals where vassal_fid=fid and status='active');
    select count(*) into v_vassal_n from public.diplo_vassals where overlord_fid=fid and status='active';
  end if;

  -- ── Отношения — _diplomacy_relations.sql (опц.) ──
  if to_regclass('public.faction_relations') is not null then
    v_amicitia := exists(select 1 from public.faction_relations where (from_fid=fid or to_fid=fid) and score>=75);
    v_enemy    := exists(select 1 from public.faction_relations where (from_fid=fid or to_fid=fid) and score<=-75);
  end if;

  -- ── Капстоун: сколько ачивок уже в копилке (считается ДО этого прохода) ──
  select count(*) into v_ach_count from public.faction_achievements where faction_id=fid;

  -- Каталог: (id, награда ГС, выполнено?) — зеркало EC_ACH в economy.js
  for rec in
    select * from (values
      ('sibi_imperare', 1000, v_research  >= 1),
      ('constantia',    2000, v_buildings >= 10),
      ('cosmopolites',  2500, v_colonies  >= 5),
      ('amor_fati',        0, v_attacked),
      ('dichotomia',    1500, v_route),
      ('temperantia',      0, v_gc >= 10000),
      ('sophia',        4000, v_research  >= 10),
      ('fortitudo',     4000, v_raid),
      ('prudentia',     3500, v_spy),
      ('iustitia',      3500, v_loan),
      ('magnum_opus',   7000, v_buildings >= 30),
      -- ── Большой набор: масштаб державы ──
      ('abundantia',         8000, v_gc >= 50000),
      ('imperium_sine_fine', 8000, v_colonies >= 10),
      ('res_publica',       15000, v_buildings >= 100),
      ('terra_nova',         3000, v_terraform),
      ('magnae_divitiae',    4000, v_resmax >= 100),
      -- ── Наука ──
      ('omniscientia',      10000, v_research >= 25),
      -- ── Торговля ──
      ('mercator',           4000, v_routes >= 5),
      ('via_argentaria',     3000, v_techsell),
      -- ── Война ──
      ('legio',              3500, v_units >= 5),
      ('imperator_belli',    8000, v_raids >= 5),
      -- ── Шпионаж ──
      ('magister_arcanorum', 8000, v_spies >= 5),
      ('missionarius',       3000, v_sect),
      -- ── Вера ──
      ('credens',            1500, v_faith_mem),
      ('fides_fundata',      3000, v_faith_found),
      ('pontifex_maximus',   5000, v_recog >= 3),
      -- ── Дипломатия ──
      ('foederati',          2000, v_union_mem),
      ('dux_foederis',       4000, v_union_lead),
      ('dominus_terrarum',   5000, v_vassal_lord),
      ('creditor_magnus',    4000, v_loan_big),
      -- ── Слово ──
      ('vox_imperii',        2000, v_news),
      -- ── Инфраструктура ──
      ('classis',            2500, v_b_shipyard),
      ('cohors_arcana',      2500, v_b_intel),
      ('plena_officina',     3000, v_full_slots),
      ('copia_rerum',        3000, v_res_kinds >= 5),
      ('arsenal',            6000, v_units >= 15),
      ('arma_omnia',         4000, v_unit_cats >= 4),
      -- ── Оборона ──
      ('contra_speculator',  3500, v_ci),
      ('inquisitor',         6000, v_caught >= 5),
      -- ── Тонкая торговля ──
      ('permutatio',         2500, v_barter),
      ('emptor',             2500, v_tech_buy),
      -- ── Тонкая дипломатия ──
      ('fidelis',            2000, v_vassal_self),
      ('amicitia',           3000, v_amicitia),
      ('debitum_solutum',    2500, v_debt_paid),
      -- ── Познание ──
      ('duae_viae',          3000, v_slots2 >= 2),
      ('ordo_cognoscendi',   2000, v_queue3 >= 3),
      -- ════════ ГРАНД-ТИРЫ (вершины каждой ветви) ════════
      ('croesus',           15000, v_gc >= 250000),
      ('urbs_aeterna',      20000, v_buildings >= 150),
      ('pax_galactica',     15000, v_colonies >= 20),
      ('terraformator',      6000, v_terraform_n >= 3),
      ('thesaurus',          8000, v_resmax >= 500),
      ('sapientia_summa',   20000, v_research >= 50),
      ('magister_magnus',   12000, v_spies >= 10),
      ('fur_maximus',        9000, v_steal_gc  >= 100000),
      ('vastator',           8000, v_destroyed >= 50),
      ('archipirata',       12000, v_raids >= 10),
      ('machina_belli',     10000, v_units >= 30),
      ('via_magna',          6000, v_routes >= 10),
      ('imperator_imperatorum', 10000, v_vassal_n >= 3),
      -- ════════ ВОЕНКА: техи классов + реальное производство ════════
      ('crucigera',          3000, v_cruiser),
      ('dreadnought',        6000, v_dread_tech),
      ('centuria_navium',    5000, v_corv >= 100),
      ('leviathan',          6000, v_dread_built),
      ('classis_magna',      8000, v_ships_built >= 50),
      -- наземка/авиация строятся ТОЛЬКО в составе дивизий → считаем сформированные дивизии
      ('legio_ferrata',      4000, v_div_built >= 10),
      ('ala_magna',          6000, v_div_built >= 30),
      -- именные корабли (создание дизайна нужного класса с нужным именем)
      ('brandtaucher',       6000, v_named_bs),
      ('belicosa',           4000, v_named_cr),
      -- ════════ УРОН ТАЙНЫХ ОПЕРАЦИЙ (накопительные итоги) ════════
      ('praeda_aurea',       4000, v_steal_gc  >= 25000),
      ('direptor',           3500, v_steal_res >= 100),
      ('eversor',            4000, v_destroyed >= 10),
      ('sicarius',           3500, v_killed    >= 3),
      ('fur_arcanorum',      4000, v_techstolen >= 3),
      -- ── Новые ветви охвата ──
      ('rete_arcanum',       5000, v_sects >= 3),
      ('magna_foederatio',   8000, v_lead_big),
      ('inimicus',           2000, v_enemy),
      ('usura',              5000, v_loans_n >= 5),
      ('industria_plena',    6000, v_btypes >= 8),
      ('dispersio',          5000, v_systems >= 5),
      -- ════════ КОЛОНИИ-СТАНЦИИ НЕБОЖИТЕЛЕЙ (нужны исследования pol.cel_*) ════════
      ('statio_orbitalis',   3500, v_giant),
      ('statio_anomala',     5000, v_anomaly_col),
      -- ════════ ПАСХАЛКА / ОСОБОЕ ════════
      ('kfzlib',             2000, v_kfzlib),
      ('templum_mundi',      5000, v_temple_sanctuary),
      ('spes_perdita',      10000, v_doom_temple),
      ('solitudo',           3000, v_outpost_edge),
      ('iudex_et_iudicium',  6000, v_doom_kill),
      ('mundicida',          8000, v_worldkiller),
      ('quinque_stationes',  5000, v_outposts_n >= 5),
      ('capitale',           3000, v_corp),
      -- ════════ КАПСТОУН: получить все остальные ════════
      ('summa_perfectio',       0, v_ach_count >= 89)
    ) as t(ach_id, reward, met)
  loop
    if rec.met then
      insert into public.faction_achievements(faction_id, ach_id, reward)
        values (fid, rec.ach_id, rec.reward)
        on conflict (faction_id, ach_id) do nothing;
      if found then                 -- именно сейчас выдали (а не уже была)
        newly   := newly + 1;
        new_ids := new_ids || to_jsonb(rec.ach_id);
        if rec.reward > 0 then
          update public.faction_economy set gc = gc + rec.reward where faction_id = fid;
        end if;
      end if;
    end if;
  end loop;

  exception when others then
    -- Пересчёт сорвался — грантов этого прохода нет (откатились), но панель
    -- покажет всё, что уже было заработано. Логируем для диагностики.
    raise warning 'ach_check recompute failed: % (%)', SQLERRM, SQLSTATE;
    v_err := SQLSTATE || ': ' || SQLERRM;   -- ДИАГ: вернём наружу, чтобы увидеть в консоли
    newly := 0; new_ids := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'newly',   newly,
    'err',     v_err,                 -- ДИАГ: null = пересчёт прошёл; иначе текст ошибки
    'new_ids', new_ids,
    'gc',      (select gc from public.faction_economy where faction_id = fid),
    'earned',  coalesce((
        select jsonb_agg(jsonb_build_object('id', ach_id, 'reward', reward, 'earned_at', earned_at)
                         order by earned_at)
        from public.faction_achievements where faction_id = fid), '[]'::jsonb)
  );
end$$;

revoke all on function public.ach_check() from public, anon;
grant execute on function public.ach_check() to authenticated;
