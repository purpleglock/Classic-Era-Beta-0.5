-- ════════════════════════════════════════════════════════════
-- ПРИРОДА МИРА: класс планеты наконец что-то значит
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_exodus.sql. Идемпотентно.
-- ⚠️ economy_accrue / economy_build__raw / economy_open_slot пересобраны с
-- ЖИВЫХ определений (pg_get_functiondef): у начисления 4 файла-предка
-- (_economy_accrue_consolidated, _budget_wellbeing, _gc_income_truth, …),
-- и какой из них лёг последним, знает только база.
--
-- ЖАЛОБА: «миры никак не влияют ни на население, ни на эффективность рабочих,
-- ни на науку, ни на что». Так и было: класс планеты жил в названии и в
-- картинке. Колония на лавовом мире считалась ровно как на землеподобном,
-- поэтому выбор «куда садиться» сводился к числу ячеек и к тому, где ближе.
--
-- ЧЕТЫРЕ ОСИ. Класс мира даёт множители по четырём числам, которые игрок
-- видит и без нас:
--   pop   — потолок населения и скорость прироста;
--   work  — выработка рабочих: добыча залежей, фабрики и торговля;
--   sci   — наука колонии;
--   build — цена постройки и открытия слота (меньше = дешевле).
--
-- ⚠️ ДЕБАФ НЕ ДЕЛАЕТ МИР НЕИГРАБЕЛЬНЫМ. Ни одна ось не уходит ниже 0.60 и
-- ни одна не поднимается выше 1.35 у обычных классов: класс должен менять
-- ОТВЕТ на вопрос «что здесь строить», а не запрещать садиться. Лава — это
-- рудный цех с плохой демографией, а не мусор; землеподобный — дом, а не
-- универсальный лучший выбор.
--
-- ⚠️ ПРИРОСТ МНОЖИТСЯ ТОЛЬКО КОГДА ОН ПОЛОЖИТЕЛЕН. Иначе хороший мир получал
-- бы бонус к вымиранию при провальном соцблоке (`_pop_growth` даёт −0.02 на
-- нуле), то есть на плохой политике рай умирал бы быстрее лавы.
--
-- ИДЕАЛЬНЫЕ МИРЫ. Отдельный класс `ideal` — то, во что превращаются
-- переплавленные кризисом миры (см. [[angel-exodus-temple]]). Дебафов нет
-- вовсе, и по каждой оси он ЗАМЕТНО выше лучшего обычного класса: 1.50/1.45/
-- 1.45 против лучших 1.15/1.30/1.30, стройка 0.75 против лучших 0.90.
-- ────────────────────────────────────────────────────────────

-- ── ТАБЛИЦА КОЭФФИЦИЕНТОВ ───────────────────────────────────
-- Одна дверь на все четыре оси: правки баланса ведутся ЗДЕСЬ и больше нигде.
create or replace function public._world_mods(p_kind text)
returns jsonb language sql immutable as $$
  select case coalesce(p_kind,'std')
    --                                pop   work   sci   build
    when 'ideal'       then jsonb_build_object('pop',1.50,'work',1.45,'sci',1.45,'build',0.75)
    when 'terrestrial' then jsonb_build_object('pop',1.15,'work',1.00,'sci',1.05,'build',0.95)
    when 'oceanic'     then jsonb_build_object('pop',1.10,'work',0.95,'sci',1.15,'build',1.00)
    when 'desert'      then jsonb_build_object('pop',0.90,'work',1.10,'sci',1.00,'build',0.95)
    when 'cryo'        then jsonb_build_object('pop',0.80,'work',1.05,'sci',1.15,'build',1.15)
    when 'volcanic'    then jsonb_build_object('pop',0.75,'work',1.25,'sci',0.95,'build',1.15)
    when 'lava'        then jsonb_build_object('pop',0.60,'work',1.30,'sci',0.90,'build',1.25)
    when 'micro'       then jsonb_build_object('pop',0.70,'work',1.15,'sci',1.00,'build',0.90)
    when 'exotic'      then jsonb_build_object('pop',0.85,'work',1.00,'sci',1.25,'build',1.20)
    when 'gasgiant'    then jsonb_build_object('pop',0.70,'work',1.20,'sci',1.10,'build',1.15)
    when 'icegiant'    then jsonb_build_object('pop',0.70,'work',1.10,'sci',1.15,'build',1.15)
    when 'hotgiant'    then jsonb_build_object('pop',0.65,'work',1.25,'sci',1.05,'build',1.20)
    when 'belt'        then jsonb_build_object('pop',0.60,'work',1.30,'sci',0.95,'build',0.90)
    when 'anomaly'     then jsonb_build_object('pop',0.65,'work',0.90,'sci',1.30,'build',1.25)
    else jsonb_build_object('pop',1.0,'work',1.0,'sci',1.0,'build',1.0) end
$$;

-- Человеческие имена — для панели колонии и для сводок.
create or replace function public._world_kind_name(p_kind text)
returns text language sql immutable as $$
  select case coalesce(p_kind,'std')
    when 'ideal' then 'Идеальный мир'        when 'terrestrial' then 'Землеподобный'
    when 'oceanic' then 'Океанический'       when 'desert' then 'Пустынный'
    when 'cryo' then 'Криомир'               when 'volcanic' then 'Вулканический'
    when 'lava' then 'Лавовый'               when 'micro' then 'Малое тело'
    when 'exotic' then 'Экзотический'        when 'gasgiant' then 'Газовый гигант'
    when 'icegiant' then 'Ледяной гигант'    when 'hotgiant' then 'Горячий гигант'
    when 'belt' then 'Пояс'                  when 'anomaly' then 'Аномалия'
    else 'Обычный мир' end
$$;

-- ── КЛАСС КОНКРЕТНОЙ КОЛОНИИ ────────────────────────────────
-- Сначала карта (там живёт признак `ideal`), потом тип из строки колонии,
-- потом — 'std' с единицами по всем осям. Неизвестный класс НИЧЕГО не ломает.
create or replace function public._world_kind(p_colony uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare c record; pl jsonb; g text;
begin
  select * into c from public.colonies where id = p_colony;
  if c.id is null then return 'std'; end if;

  if c.planet_pid is not null then
    select p into pl from public.map_systems m,
         lateral jsonb_array_elements(coalesce(m.planets,'[]'::jsonb)) p
     where m.id = c.system_id and (p->>'pid')::int = c.planet_pid limit 1;
  end if;
  if pl is not null and coalesce((pl->>'ideal')::boolean, false) then return 'ideal'; end if;
  if pl is not null then
    g := public._ec_group_of(pl);
    if g is not null and g <> 'unknown' then return g; end if;
  end if;

  g := public._ec_planet_group(c.planet_type);
  if g <> 'unknown' then return g; end if;
  if position('·' in coalesce(c.planet_type,'')) > 0 then return 'belt'; end if;
  return 'std';
end$$;

-- Один множитель по имени оси. Ключ берём из готовой карты классов,
-- чтобы начисление не бегало в jsonb карты на каждую залежь.
create or replace function public._world_m(p_kind text, p_axis text)
returns numeric language sql immutable as $$
  select coalesce((public._world_mods(p_kind)->>p_axis)::numeric, 1)
$$;

-- Карта «колония → класс» на одну державу: строится раз за тик.
create or replace function public._world_map(p_fid text)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_object_agg(c.id::text, public._world_kind(c.id)), '{}'::jsonb)
    from public.colonies c where c.faction_id = p_fid
$$;

-- Витрина для панели колонии: класс, имя, множители.
create or replace function public.world_class(p_colony uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('kind', public._world_kind(p_colony),
                            'name', public._world_kind_name(public._world_kind(p_colony)),
                            'mods', public._world_mods(public._world_kind(p_colony)))
$$;
grant execute on function public.world_class(uuid) to authenticated;

-- ── ПЕРЕПЛАВЛЕННЫЕ → ИДЕАЛЬНЫЕ ──────────────────────────────
-- Кризис оставил после себя 56 стеклянных шаров без слотов и с `dead`.
-- Оставить их такими — значит наказать переживших дважды: сначала съели,
-- потом на месте мира вечная дырка в карте. Планета возвращается в игру, но
-- уже не той, какой была: ни ячеек прежнего владельца, ни построек — чистый
-- лист, на который может сесть кто угодно, и он лучший в галактике.
create or replace function public.world_melted_to_ideal()
returns jsonb language plpgsql security definer set search_path=public as $$
declare m record; arr jsonb; newpl jsonb; el jsonb; i int; n int := 0; touched int := 0;
begin
  for m in select id, coalesce(planets,'[]'::jsonb) pls from public.map_systems
            where planets @> '[{"melted":true}]'::jsonb
  loop
    arr := m.pls; newpl := '[]'::jsonb;
    for i in 0 .. coalesce(jsonb_array_length(arr),1)-1 loop
      el := arr->i;
      if coalesce((el->>'melted')::boolean,false) and not coalesce((el->>'ideal')::boolean,false) then
        el := el || jsonb_build_object(
               'g','gaia', 'kind','planet', 'type','Идеальный мир',
               'icon','🌍', 'slotsP', 8, 'slotsK', 0,
               'ideal', true, 'dead', false, 'doomed', false,
               'ideal_at', to_jsonb(now()));
        el := el - 'melted';
        n := n + 1;
      end if;
      newpl := newpl || jsonb_build_array(el);
    end loop;
    update public.map_systems set planets = newpl where id = m.id;
    touched := touched + 1;
  end loop;

  if n > 0 then
    perform public._angel_news('◈ НА МЕСТЕ ПЕРЕПЛАВЛЕННЫХ МИРОВ ЧТО-ТО ЕСТЬ',
      'Зонды, посланные к остывшим шарам, вернулись с картинкой, которой там '
      || 'быть не может: вода, воздух, ровный климат и почва, в которой '
      || 'приживается всё. Ни следа прежних городов — поверхность переписана '
      || 'начисто. Таких миров теперь ' || n || ', и они ничьи.');
  end if;
  return jsonb_build_object('ok', true, 'ideal', n, 'systems', touched);
end$$;
revoke all on function public.world_melted_to_ideal() from public;

create or replace function public.admin_world_melted_to_ideal()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  return public.world_melted_to_ideal();
end$$;
revoke all on function public.admin_world_melted_to_ideal() from public;
grant execute on function public.admin_world_melted_to_ideal() to authenticated;


-- ── ПРИРОСТ ─────────────────────────────────────────────────
-- Множитель поднимает только положительный прирост. Отрицательный (провальный
-- соцблок, −0.02/сут) остаётся как есть: климат не ускоряет вымирание.
create or replace function public._world_grow(p_rate numeric, p_mult numeric)
returns numeric language sql immutable as $$
  select case when coalesce(p_rate,0) > 0 then p_rate * coalesce(p_mult,1)
              else coalesce(p_rate,0) end
$$;

-- ── ПЕРЕСОБРАННЫЕ ДВЕРИ ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.economy_accrue(p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  eco public.faction_economy; d int;
  wk jsonb := '{}'::jsonb;   -- ПРИРОДА МИРА: колония → класс
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric; tier_f numeric; slot_f numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  -- РАБОЧИЕ (единая модель с панелью «⛏ Ресурсы»)
  w_alloc jsonb := '{}'::jsonb; w_dem jsonb := '{}'::jsonb; dep_w numeric; cov numeric;
  -- ОБЩИЙ СКЛАД
  stored jsonb := '{}'::jsonb;
  v_used numeric; v_free numeric; v_want numeric; v_stored numeric := 0; v_lost numeric := 0;
  q numeric; ff numeric;
  -- ══ ВОЗВРАТ 03.08: БЮДЖЕТ (клоббер _science_special_buildings 27.07) ══
  bdg public.faction_budget;                         -- БЮДЖЕТ: ползунки
  bdg_cost numeric := 0;                             -- БЮДЖЕТ: апкип ГС/сут
  w_mult numeric := 1;                               -- БЮДЖЕТ: благополучие (× ГС-доход)
  -- ТОВАРЫ (фабрика: поток строго под спрос населения)
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1;
  -- РЕЦЕПТ ТОВАРОВ (07.08): фабрика ест выбранные ресурсы; премиальные входы
  -- поднимают потолок благополучия 1.10 → 1.25 (∝ обеспечению × разнообразию).
  gr_recipe jsonb; gr_ing jsonb; gr_name text;
  gr_qty numeric; gr_avail numeric; gr_ratio numeric;
  gr_q numeric := 1; gr_div numeric := 0; gr_bonus numeric := 0;
  -- ПРОСПЕРИТИ (06.08): множитель дохода домиков по благополучию системы.
  prosp jsonb := '{}'::jsonb;
  -- ВЕРА (06.08): храмы/десятина/секты наконец начисляются тиком.
  t_rate numeric := 0; t_paid numeric := 1; temple_gc numeric := 0; tithe_gc numeric := 0; sects_gc numeric := 0;
  bld_gc numeric := 0; tmpl_gc numeric := 0; faith_gc numeric := 0;
  -- РЕВОРК МАШИН 17.08: раса «Синтетики / Киборги» ИЛИ правление «Машинный разум».
  v_robot boolean := false;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  v_robot := public._faction_is_robot(p_fid);
  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  -- БЮДЖЕТ: ползунки + благополучие + апкип (ВОЗВРАТ 03.08)
  bdg := public._budget_row(p_fid);
  -- МАШИНЫ: соцблок им безразличен — ни бонуса 1.15, ни провала 0.85.
  w_mult := case when v_robot then 1 else public._budget_gc_mult(bdg.social) end;
  m_gc := m_gc * w_mult;
  bdg_cost := public._budget_upkeep(p_fid);

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  -- ПРИРОДА МИРА: класс каждой колонии считаем ОДИН раз за тик — дальше
  -- по нему идут и добыча, и фабрики, и наука, и население.
  wk := public._world_map(p_fid);

  -- ══ ПРОСПЕРИТИ СИСТЕМ (06.08) ══════════════════════════════════════
  -- Благополучие системы наконец влияет на ДЕНЬГИ. Раньше просперити жила
  -- только в клиенте (ecBuildingProsp) и в _bld_daily_gc (дивиденды корпораций),
  -- а тик считал доход домиков плоско — отсюда и расхождение чисел у игроков.
  -- _econ_update_status пересчитывает просперити и КЛАДЁТ её в system_econ;
  -- до сегодня её не звал НИКТО (статусы бедности стояли с 24.07). Теперь её
  -- зовёт тик, а и начисление, и панель читают одно и то же число из кэша.
  if d >= 1 then
    perform public._econ_update_status(p_fid, d);
  end if;
  -- ⚠ алиас НЕ 'q': в функции уже есть переменная q (numeric) — будет конфликт имён
  select coalesce(jsonb_object_agg(psys.sid, psys.pv), '{}'::jsonb) into prosp from (
    select distinct c.system_id as sid, public._prosp_of(c.system_id) as pv
    from public.colonies c where c.faction_id = p_fid and c.system_id is not null) psys;

  -- ставка храма «ВОЛНЫ»: 150…480 ГС/слот от охвата, памятников, рвения и сети адептов
  t_rate := public._faith_temple_rate(p_fid);
  -- ⚠ ПОТОЛОК ПАСТВЫ. Ставка ВОЛНЫ уже насыщена при cov=1 (_faith_coverage режет
  -- охват на единице), но платить за КАЖДЫЙ слот сверх покрытия населения нельзя:
  -- на проверке держава с ~1200 слотов храмов получала 986k ГС/сут — больше всей
  -- своей промышленности, храм выходил доходнее фабрики (360 против 200 за слот).
  -- Платят только те слоты, чья зона вещания реально накрывает людей; остальные —
  -- памятники веры, а не источник денег.
  t_paid := public._faith_paid_frac(p_fid);

  for r in
    select cb.btype, cb.slots_open, cb.faith_id,
           coalesce((prosp->>c.system_id)::numeric, 1) as pr,
           public._world_m(wk->>cb.colony_id::text, 'work') as w_work,
           public._world_m(wk->>cb.colony_id::text, 'sci')  as w_sci
    from public.colony_buildings cb
    left join public.colonies c on c.id = cb.colony_id
    where cb.faction_id = p_fid
  loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200*r.pr*r.w_work;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100*r.pr*r.w_work;
    elsif r.btype='temple' then
      -- гейт по вере: храм платит, пока держава исповедует ЕГО веру
      -- (faith_id null = старый храм, годится при любой вере). Зеркало ecTempleIncome.
      if exists(select 1 from public.faith_membership mm
                 where mm.faction_id = p_fid
                   and (r.faith_id is null or mm.faith_id = r.faith_id)) then
        temple_gc := temple_gc + r.slots_open * t_paid * t_rate * r.pr;
      end if;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1*r.w_sci;
    elsif r.btype='sci_giant' then inc_sci := inc_sci + r.slots_open*3*r.w_sci;
    elsif r.btype='sci_anomaly' then inc_sci := inc_sci + r.slots_open*5*r.w_sci;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    -- Ёмкость ОБЩЕГО склада: база + слоты складов, × множитель инфраструктуры
    -- (зеркало _outpost_mining_settle и ecStoreCap на клиенте).
    cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500)
                 * public._budget_cap_mult(bdg.infra)
                 * case when v_robot then 1.5 else 1 end);   -- МАШИНЫ: дроны-логисты, склад +50%

    -- ══ ДОБЫЧА: ставка залежи × покрытие рабочими (сведено 2026-08-03) ═══
    -- Ставка 29.07 (редкость × богатство × доктрина × домик) и потолок залежи
    -- сохранены — балансовый уровень тот же. Новое: сколько из ставки реально
    -- добыто, решают РАБОЧИЕ, ровно как показывает панель «⛏ Ресурсы».
    -- Перебор по _worker_deposits: залежи всех моих колоний + концессии на
    -- чужих; домик больше не обязателен (он буст, а не гейт присутствия).
    w_alloc := public._worker_alloc(p_fid);
    for r in select colony_id, demand from public._worker_demand(p_fid) loop
      w_dem := jsonb_set(w_dem, array[r.colony_id::text], to_jsonb(r.demand), true);
    end loop;

    for bld in
      select dp.colony_id, dp.res_name as q_name, dp.rarity as q_rar, dp.amt as q_amt,
             dp.dep_demand, dp.house_slots,
             -- полная ставка залежи при 100% покрытии рабочими
             greatest(1, round(
               (case dp.rarity when 'uncommon' then 12 when 'rare' then 6
                               when 'epic' then 3 when 'legendary' then 1 else 25 end)
               * public._richness_mult(dp.amt) * m_mine * public._house_mult(dp.house_slots)
               * public._world_m(wk->>dp.colony_id::text, 'work')
             )) as q_full,
             greatest(1, round(public._mine_cap(dp.amt) * 8 * m_mine)) as dep_cap,
             -- доля вывоза = доля слотов добывающих построек колонии в режиме «экспорт»
             coalesce((select sum(case when coalesce(cb.mine_mode,'store')='export'
                                       then greatest(1, coalesce(cb.slots_open,1)) else 0 end)::numeric
                            / nullif(sum(greatest(1, coalesce(cb.slots_open,1))),0)
                       from public.colony_buildings cb
                      where cb.colony_id = dp.colony_id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')), 0) as exp_share
      from public._worker_deposits(p_fid) dp
    loop
      rname := bld.q_name;
      rr := bld.q_rar;
      if bld.dep_demand is null or bld.dep_demand <= 0 then continue; end if;
      -- рабочие колонии делятся между её залежами пропорционально спросу
      dep_w := floor(coalesce((w_alloc->>bld.colony_id::text)::numeric, 0)
                     * bld.dep_demand
                     / nullif(coalesce((w_dem->>bld.colony_id::text)::numeric, 0), 0));
      if dep_w is null or dep_w < 5 then continue; end if;   -- «нет рабочих» — как в панели
      cov := least(1, dep_w / bld.dep_demand);
      rate := least(bld.dep_cap, round(bld.q_full * cov));
      if rate <= 0 then continue; end if;
      declare
        to_exp numeric; to_store numeric;
      begin
        to_exp := round(rate * bld.exp_share);
        to_store := greatest(0, rate - to_exp);
        if to_exp > 0 then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + to_exp*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        end if;
        if to_store > 0 then
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + to_store*d), true);
        end if;
      end;
    end loop;

    -- ════════ ТОВАРЫ: поток ПОД СПРОС (ВОЗВРАТ 03.08) ══════════════════
    -- Товары НЕ РЕСУРС: не пишутся на склад, не продаются, не копятся.
    -- Фабрика делает РОВНО столько, сколько съедает население за тик
    -- (спрос = pop/600/сут, зеркало EC_GOODS_DEMAND_DIV), и списывает
    -- воду/сырьё ПРОПОРЦИОНАЛЬНО выпуску (6 воды + 4 сырья на 10 товаров).
    goods_demand := public._fac_pop(p_fid) / 600.0 * d;
    -- МАШИНЫ не потребляют ТНП: спроса нет, фабрика товаров им бесполезна,
    -- зато вода и сырьё не сгорают. Просперити зафиксировано на 1.00 (см. ниже).
    if v_robot then goods_demand := 0; end if;
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    begin gr_recipe := public._goods_recipe(p_fid);
    exception when undefined_function then gr_recipe := null; end;
    if gf_slots > 0 and goods_demand > 0 and gr_recipe is not null then
      -- РЕЦЕПТ: узкое место по ВСЕМ ингредиентам (qty на 1 товар), затем расход.
      gr_ratio := 1;
      for gr_ing in select value from jsonb_array_elements(gr_recipe->'ingredients') loop
        gr_name := gr_ing->>'res';
        gr_qty  := coalesce((gr_ing->>'qty')::numeric, 0);
        if gr_qty <= 0 then continue; end if;
        gr_avail := greatest(0, coalesce((eco.resources->>gr_name)::numeric,0)
                               + coalesce((res_add->>gr_name)::numeric,0)
                               - coalesce((res_sub->>gr_name)::numeric,0));
        gr_ratio := least(gr_ratio, gr_avail / (gr_qty * 10 * gf_slots * d));
      end loop;
      gf_ratio := greatest(0, least(1, gr_ratio));
      gf_made  := least(goods_demand, 10 * gf_slots * d * gf_ratio);
      if gf_made > 0 then
        for gr_ing in select value from jsonb_array_elements(gr_recipe->'ingredients') loop
          gr_name := gr_ing->>'res';
          gr_qty  := coalesce((gr_ing->>'qty')::numeric, 0);
          if gr_qty <= 0 then continue; end if;
          res_sub := jsonb_set(res_sub, array[gr_name],
                       to_jsonb(coalesce((res_sub->>gr_name)::numeric,0) + gr_qty * gf_made), true);
        end loop;
      end if;
      gr_q   := coalesce((gr_recipe->>'q_avg')::numeric, 1);
      gr_div := coalesce((gr_recipe->>'diversity')::numeric, 0);
    elsif gf_slots > 0 and goods_demand > 0 then
      av_lyod  := greatest(0, coalesce((eco.resources->>'Лёд')::numeric,0)         + coalesce((res_add->>'Лёд')::numeric,0)         - coalesce((res_sub->>'Лёд')::numeric,0));
      av_water := greatest(0, coalesce((eco.resources->>'Жидкая вода')::numeric,0) + coalesce((res_add->>'Жидкая вода')::numeric,0) - coalesce((res_sub->>'Жидкая вода')::numeric,0));
      av_iron  := greatest(0, coalesce((eco.resources->>'Железо')::numeric,0)      + coalesce((res_add->>'Железо')::numeric,0)      - coalesce((res_sub->>'Железо')::numeric,0));
      av_silic := greatest(0, coalesce((eco.resources->>'Силикаты')::numeric,0)    + coalesce((res_add->>'Силикаты')::numeric,0)    - coalesce((res_sub->>'Силикаты')::numeric,0));
      -- потолок мощности за тик и входы под ПОЛНУЮ мощность (для ratio-отчёта)
      gf_water_need := 6 * gf_slots * d;
      gf_mat_need   := 4 * gf_slots * d;
      gf_ratio := least(1,
        case when gf_water_need > 0 then (av_lyod + av_water) / gf_water_need else 1 end,
        case when gf_mat_need   > 0 then (av_iron + av_silic) / gf_mat_need   else 1 end);
      gf_ratio := greatest(0, gf_ratio);
      -- выпуск = минимум из спроса и мощности, ограниченной входами
      gf_made := least(goods_demand, 10 * gf_slots * d * gf_ratio);
      if gf_made > 0 then
        -- входы списываются под ФАКТИЧЕСКИЙ выпуск: 0.6 воды + 0.4 сырья на товар
        need := gf_made * 0.6;
        take := least(need, av_lyod);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Лёд'], to_jsonb(coalesce((res_sub->>'Лёд')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_water);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Жидкая вода'], to_jsonb(coalesce((res_sub->>'Жидкая вода')::numeric,0)+take), true); end if;
        end if;
        need := gf_made * 0.4;
        take := least(need, av_iron);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Железо'], to_jsonb(coalesce((res_sub->>'Железо')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_silic);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Силикаты'], to_jsonb(coalesce((res_sub->>'Силикаты')::numeric,0)+take), true); end if;
        end if;
      end if;
    end if;
    -- обеспечение = выпуск/спрос (0..1) → множитель дохода: 1 → ×1.10, 0 → ×0.90
    goods_cov := case when goods_demand > 0 then round(least(1, gf_made / goods_demand), 3) else 1 end;
    -- КАЧЕСТВО: премиальный рецепт даёт бонус сверх 1.10 (потолок +0.15 → 1.25),
    -- пропорционально обеспечению и разнообразию входов. Легаси → бонуса нет.
    gr_bonus := case when gr_recipe is null then 0
                     else least(0.15, greatest(0, gr_q - 1)) * gr_div end;
    goods_welfare := round(least(1.10 + gr_bonus,
                       greatest(0.90, 0.90 + 0.20 * goods_cov + goods_cov * gr_bonus)), 3);
    if v_robot then goods_welfare := 1; goods_cov := 1; end if;   -- МАШИНЫ: ни просперити, ни голода

    -- ══ НАСЕЛЕНИЕ: рост = соцобеспечение + товары + памятник (ВОЗВРАТ 03.08) ══
    -- Потолок ячейки×100, пол ячейки×10, бэкфилл старых записей ячейки×50.
    -- Памятник Веры даёт колонии +0.5%/сут — работает и до модерации облика.
    update public.colonies c
       set pop = least(round(coalesce(c.cells,0)*100 * public._world_m(wk->>c.id::text,'pop')),
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           -- ⚠️ ПРИРОСТ УМНОЖАЕТСЯ, ТОЛЬКО ПОКА ОН ПОЛОЖИТЕЛЕН:
                           -- иначе рай при провальном соцблоке вымирал бы быстрее лавы.
                           * power(1 + public._world_grow(public._pop_growth(case when v_robot
                                             then bdg.industry else bdg.social end),
                                             public._world_m(wk->>c.id::text,'pop'))
                                     + case when v_robot then 0 else 0.01 * least(1, goods_cov) end
                                     + case when exists(select 1 from public.faith_monuments fm
                                                        where fm.colony_id = c.id and fm.status <> 'rejected')
                                            then 0.005 else 0 end, d))))
     where c.faction_id = p_fid;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until from public.trade_routes where status='active' and a_fid=p_fid loop
      if r.transit_until is not null and r.transit_until > now() then continue; end if;
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      select coalesce(score,0) into rel_score from public.faction_relations where from_fid=p_fid and to_fid=r.b_fid;
      dip_coef := greatest(0.8, least(1.2, 1 + coalesce(rel_score,0)/500.0));

      if jsonb_array_length(coalesce(r.cargo,'[]'::jsonb)) > 0 then
        for citem in select value from jsonb_array_elements(r.cargo) loop
          rname := citem->>'res';
          avail := coalesce((mine_flow->>rname)::numeric, 0);
          shipped := least(coalesce((citem->>'vol')::numeric,0)*d, avail);
          if shipped <= 0 then continue; end if;
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        shipped := least(coalesce(r.volume,0)*d, avail);
        if shipped > 0 then
          mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    -- ══ ВЕРА: десятина и тайные секты (06.08) ═════════════════════════
    -- Десятина основателю: 20% дохода храмов ЧУЖИХ адептов моих вер, по ИХ
    -- собственной ставке ВОЛНЫ. Это НАДБАВКА основателю — у адепта ничего
    -- не вычитается (иначе вступление в чужую веру было бы чистым минусом).
    select coalesce(sum(public._faith_flock(mm.faction_id, f.id)
                        * public._faith_temple_rate(mm.faction_id) * 0.20), 0)
      into tithe_gc
      from public.faith_membership mm
      join public.faiths f on f.id = mm.faith_id
     where f.founder_fid = p_fid and mm.faction_id <> p_fid;
    -- тайные секты за рубежом = скрытые храмы по моей ставке (просперити нет — чужая земля)
    select coalesce(count(*),0) * t_rate into sects_gc
      from public.faith_sects where owner_fid = p_fid and status = 'active';
    tithe_gc := round(tithe_gc * m_gc * d);
    sects_gc := round(sects_gc * m_gc * d);

    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select res_name, res_rar, avail from (
          select distinct on (nm) nm as res_name, rr as res_rar,
            greatest(0, coalesce((eco.resources->>nm)::numeric,0)
                        + coalesce((res_add->>nm)::numeric,0)
                        - coalesce((res_sub->>nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by nm, public._res_value(nm, rr) desc
        ) u
        where avail > 0
        order by public._res_value(res_name, res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    -- ══ СКЛАД: лимит ОБЩИЙ на все ресурсы вместе ═══════════════════════
    -- Было `least(cap, склад_k + добыча_k)` по каждому ресурсу — суммарный
    -- склад получался фактически безлимитным (в 5–22 раза сверх ёмкости).
    merged := coalesce(eco.resources,'{}'::jsonb);

    -- 1) списания (товарная биржа + входы фабрики товаров) — освобождают
    --    место. Продали больше, чем лежало → недостачу берём из свежей
    --    добычи: сбыт идёт мимо склада, склад в минус не уходит.
    for k in select jsonb_object_keys(res_sub) loop
      q := coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric;
      if q < 0 then
        res_add := jsonb_set(res_add, array[k],
                     to_jsonb(greatest(0, coalesce((res_add->>k)::numeric,0) + q)), true);
        q := 0;
      end if;
      merged := jsonb_set(merged, array[k], to_jsonb(q), true);
    end loop;

    -- 2) добыча ложится только в СВОБОДНОЕ место
    select coalesce(sum(value::numeric),0) into v_used from jsonb_each_text(merged);
    select coalesce(sum(value::numeric),0) into v_want from jsonb_each_text(res_add);
    v_free := greatest(0, cap - v_used);
    if v_want > 0 and v_free > 0 then
      ff := least(1, v_free / v_want);
      -- пропорционально: переполнение режет все ресурсы одинаково, а не первый по алфавиту
      for k in select key from jsonb_each_text(res_add) order by (value::numeric) desc loop
        q := least(floor((res_add->>k)::numeric * ff), v_free - v_stored);
        if q > 0 then
          stored := jsonb_set(stored, array[k], to_jsonb(q), true);
          v_stored := v_stored + q;
        end if;
      end loop;
      -- добор: место, потерянное на округлении вниз, отдаём наибольшим остаткам
      for k in select key from jsonb_each_text(res_add) order by (value::numeric) desc loop
        exit when v_stored >= v_free;
        q := least((res_add->>k)::numeric - coalesce((stored->>k)::numeric,0), v_free - v_stored);
        if q > 0 then
          stored := jsonb_set(stored, array[k], to_jsonb(coalesce((stored->>k)::numeric,0) + q), true);
          v_stored := v_stored + q;
        end if;
      end loop;
      for k in select jsonb_object_keys(stored) loop
        merged := jsonb_set(merged, array[k],
                    to_jsonb(coalesce((merged->>k)::numeric,0) + (stored->>k)::numeric), true);
      end loop;
    end if;
    v_lost := greatest(0, v_want - v_stored);   -- сгорело: нет места на складе

    -- Слагаемые дохода одним местом — чтобы казна, income_history и превью
    -- считались ОДНИМ выражением и не могли разойтись (болезнь 06.08).
    bld_gc  := round(inc_gc * m_gc * goods_welfare * d);      -- фабрики+хабы × просперити
    tmpl_gc := round(temple_gc * m_gc * goods_welfare * d);   -- храмы × просперити
    faith_gc := tmpl_gc + tithe_gc + sects_gc;

    update public.faction_economy
      set gc = greatest(0, gc + bld_gc + faith_gc + trade_gc + market_gc + export_gc
                            - policy_cost * d - bdg_cost * d),   -- БЮДЖЕТ: апкип · ТОВАРЫ: × welfare
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    -- Статистика: mined = что РЕАЛЬНО легло на склад (было — сырая добыча).
    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined, mined_lost,
                                      gc_temple, gc_tithe, gc_sects)
      values(p_fid, eco.owner_id, d,
        bld_gc, trade_gc, market_gc, export_gc,
        (policy_cost + bdg_cost) * d,                            -- БЮДЖЕТ: апкип в расходах
        bld_gc + faith_gc + trade_gc + market_gc + export_gc
          - (policy_cost + bdg_cost) * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        v_stored, v_lost,
        tmpl_gc, tithe_gc, sects_gc);
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  -- завершение готовых исследований + автозапуск очереди (после начисления ОН)
  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'goods', jsonb_build_object('demand', round(goods_demand),   -- ТОВАРЫ: поток под спрос
       'coverage', goods_cov, 'welfare', goods_welfare, 'made', round(gf_made), 'ratio', gf_ratio),
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc * goods_welfare),
      'temple', round(temple_gc * m_gc * goods_welfare),
      'tithe',  case when d >= 1 then round(tithe_gc / d) else 0 end,
      'sects',  case when d >= 1 then round(sects_gc / d) else 0 end,
      'temple_rate', t_rate,
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate, 'budget', bdg_cost,
      'mined',  v_stored, 'mined_lost', v_lost, 'store_cap', cap),
    'budget', jsonb_build_object(                                -- БЮДЖЕТ: ползунки для клиента
      'industry', bdg.industry, 'military', bdg.military, 'science', bdg.science,
      'social', bdg.social, 'infra', bdg.infra,
      'pop', public._fac_pop(p_fid), 'pop_cap', public._fac_pop_cap(p_fid),
      'growth', public._pop_growth(bdg.social),
      'upkeep', bdg_cost, 'w_mult', w_mult));
end
$function$
;

CREATE OR REPLACE FUNCTION public.economy_build__raw(p_colony_id uuid, p_btype text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- свободные ячейки: считаем ТОЛЬКО строки текущей фракции, иначе
  -- фантомы прошлого владельца (при захвате/передаче планеты) блокируют застройку.
  select count(*) into used    from public.colony_buildings
    where colony_id = p_colony_id and faction_id = fid;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build' and faction_id = fid;
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);
  -- ПРИРОДА МИРА: где тяжелее жить, там дороже строить.
  cost := greatest(1, round(cost * public._world_m(public._world_kind(p_colony_id), 'build')));

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype)),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$function$
;

CREATE OR REPLACE FUNCTION public.economy_build__raw(p_colony_id uuid, p_btype text, p_faith_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  -- МУЛЬТИ: храм можно строить только исповедуя веру; метка = выбранная вера
  if p_btype = 'temple' then
    if not exists(select 1 from public.faith_membership where faction_id = fid) then
      raise exception 'no faith: found or join a faith before building a temple';
    end if;
    if p_faith_id is null then
      select faith_id into p_faith_id from public.faith_membership
        where faction_id = fid order by (role = 'founder') desc, joined_at asc limit 1;
    elsif not public._faith_member(fid, p_faith_id) then
      raise exception 'you do not follow that faith';
    end if;
  else
    p_faith_id := null;
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- ДОМИК: Центр благополучия — гейт технологией + лимит 1/система, 5/держава.
  if p_btype = 'wellhub' then
    if not (select coalesce(research, '[]'::jsonb) ? 'pol.welfare_hub'
            from public.faction_economy where faction_id = fid) then
      raise exception 'нужна технология «Центр благополучия»';
    end if;
    if (select count(*) from public.colony_buildings cb
          join public.colonies c on c.id = cb.colony_id
          where c.faction_id = fid and c.system_id is not distinct from col.system_id and cb.btype = 'wellhub')
     + (select count(*) from public.colony_projects pr
          join public.colonies c on c.id = pr.colony_id
          where pr.kind = 'build' and pr.btype = 'wellhub'
            and c.faction_id = fid and c.system_id is not distinct from col.system_id) >= 1 then
      raise exception 'В этой системе уже есть Центр благополучия (лимит 1 на систему)';
    end if;
    if (select count(*) from public.colony_buildings where faction_id = fid and btype = 'wellhub')
     + (select count(*) from public.colony_projects where faction_id = fid and kind = 'build' and btype = 'wellhub') >= 5 then
      raise exception 'Достигнут лимит Центров благополучия в державе (5)';
    end if;
  end if;

  -- ГИГАНТСКАЯ ОБСЕРВАТОРИЯ: только на станции над газовым/ледяным/горячим гигантом.
  if p_btype = 'sci_giant' and col.planet_type not in ('Газовые гиганты', 'Ледяные гиганты', 'Горячие гиганты') then
    raise exception 'Гигантская обсерватория строится только на станции над гигантом';
  end if;

  -- ИНСТИТУТ АНОМАЛИЙ: только на станции внутри аномалии.
  if p_btype = 'sci_anomaly' and col.planet_type is distinct from 'Аномалии' then
    raise exception 'Институт аномалий строится только на станции внутри аномалии';
  end if;

  -- свободные ячейки: ТОЛЬКО строки текущей фракции (см. _colony_cells_faction_fix.sql)
  select count(*) into used    from public.colony_buildings
    where colony_id = p_colony_id and faction_id = fid;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build' and faction_id = fid;
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);
  -- ПРИРОДА МИРА: где тяжелее жить, там дороже строить.
  cost := greatest(1, round(cost * public._world_m(public._world_kind(p_colony_id), 'build')));

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype),
                        'faith_id', p_faith_id),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$function$
;

CREATE OR REPLACE FUNCTION public.economy_open_slot(p_building_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid text; b public.colony_buildings; cost numeric; pend int;
begin
  fid := public._ec_my_fid();
  select * into b from public.colony_buildings where id = p_building_id;
  if not found then raise exception 'building not found'; end if;
  if b.faction_id is distinct from fid then raise exception 'not your building'; end if;
  if coalesce(b.slots_open,0) >= 6 then raise exception 'all slots open'; end if;

  select count(*) into pend from public.colony_projects
    where kind = 'slot' and building_id = p_building_id;
  if pend > 0 then raise exception 'slot already in progress'; end if;

  cost := public._ec_build_cost(fid, public._ec_bld_ladder(b.btype, coalesce(b.slots_open,0)));
  -- ПРИРОДА МИРА: та же скидка/надбавка, что и на самой постройке.
  cost := greatest(1, round(cost * public._world_m(public._world_kind(b.colony_id), 'build')));

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, colony_id, building_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'slot', b.colony_id, p_building_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0),
     'Слот', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$function$
;


notify pgrst, 'reload schema';
