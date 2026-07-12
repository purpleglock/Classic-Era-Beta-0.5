-- ============================================================
-- БЮДЖЕТ ДЕРЖАВЫ · благополучие v4 · живое население · авто-добыча · ТОВАРЫ
-- Применять в Supabase → SQL Editor ПОСЛЕ _res_flows.sql. Идемпотентно.
--
-- Что даёт:
--   1) faction_budget — 5 ползунков финансирования (0..4, по умолч. 2):
--        industry — промышленность: слоты гражданских построек (и темп добычи!)
--        military — оборонзаказ: слоты военных построек + скорость постройки
--                   юнитов; УРОВЕНЬ 0 = юниты НЕ строятся вовсе
--        science  — образование/наука: слоты науки/разведцентров + множитель ОН
--        social   — соцобеспечение: благополучие (× весь ГС-доход) + РОСТ НАСЕЛЕНИЯ
--        infra    — инфраструктура: множитель ёмкости складов
--   2) ЖИВОЕ НАСЕЛЕНИЕ (colonies.pop): каждая колония держит численность.
--        · потолок = ячейки × 100 (колонизация/терраформ поднимают потолок)
--        · старт/бэкфилл = ячейки × 50, пол = ячейки × 10 (не вымирает в ноль)
--        · рост %/сут = соцобеспечение [-2, +0.5, +1.5, +2.5, +3.5]
--          + до +1%/сут за ПОЛНОЕ обеспечение ТОВАРАМИ (второй рычаг роста)
--      Население = налоговая база (апкип бюджета) и рабочие руки (слоты).
--   3) ЦЕНА ПРОГРЕССИВНАЯ: апкип = население × Σ(ставка × вес).
--      Вес уровня [0,1,2,4,7] — «норма» дешёвая, «максимум» кусается; ставки
--      на душу 0.12/0.15/0.12/0.12/0.09; ставка ЕДИНАЯ для всех (скидки нет).
--      Апкип списывается в economy_accrue и виден в income.budget.
--   3a) ТОВАРЫ ДЕМАТЕРИАЛИЗОВАНЫ (2026-07-12): не ресурс, а поток под спрос
--       внутри тика — без склада, без излишка, без биржи (см. блок в accrue;
--       разовая чистка и снятие с рынка — _goods_dematerialize.sql)
--      клобберился версиями accrue начиная с _faith_multi — возвращён сюда.
--      Спрос = живое население/600 товаров/сут; welfare ×[0.90..1.10] к доходу
--      построек; излишек продаётся на Товарной бирже первым (12 ГС × 0.6).
--   4) СЛОТЫ НЕ ОТКРЫВАЮТСЯ ВРУЧНУЮ: economy_open_slot отозван. Раз в тик
--      _budget_auto_slots выставляет slots_open из уровня профильного ползунка;
--      КАЖДЫЙ СЛОТ ТРЕБУЕТ 3 ЖИТЕЛЕЙ — не хватает рабочих рук, слоты
--      срезаются пропорционально по всем постройкам.
--   5) АВТО-ДОБЫЧА: mining-завод копает ВСЕ залежи своей планеты сам,
--      выбор «что добывать» убран (mining_assign отозван). Темп по залежи =
--      база(редкость) × богатство × доктрина × (слоты/3): слоты — рабочие
--      руки, т.е. добыча растёт от промышленного бюджета и населения.
--      Куда идёт поток (склад/экспорт/биржа/лимиты) — ТОЛЬКО вкладка «Потоки».
--   6) Скорость военпрома: триггер на unit_production правит ready_at
--      (уровень 1 = ×1.5 дольше, 2 = как раньше, 3 = ×0.8, 4 = ×0.65),
--      уровень 0 — запрет заказа. Триггер не клоббирует RPC заказа юнитов.
--
-- ВАЖНО (источник истины): пересоздаёт economy_accrue как СТРОГОЕ
-- надмножество версии из _res_flows.sql (строки -- ВЕРА / -- МУЛЬТИ /
-- -- ПОТОКИ сохранены). Добавленное помечено «-- БЮДЖЕТ:». При будущих
-- слайсах, трогающих economy_accrue, продублируйте строки «-- БЮДЖЕТ:».
-- ============================================================

-- ── 1) СХЕМА ────────────────────────────────────────────────
-- Живое население колонии (null = ещё не бэкфилнено, считается как cells×50)
alter table public.colonies add column if not exists pop numeric;

create table if not exists public.faction_budget (
  faction_id text primary key,
  industry   smallint not null default 2 check (industry between 0 and 4),
  military   smallint not null default 2 check (military between 0 and 4),
  science    smallint not null default 2 check (science between 0 and 4),
  social     smallint not null default 2 check (social between 0 and 4),
  infra      smallint not null default 2 check (infra between 0 and 4),
  updated_at timestamptz not null default now()
);
alter table public.faction_budget enable row level security;
drop policy if exists fb_select_own on public.faction_budget;
create policy fb_select_own on public.faction_budget
  for select to authenticated using (faction_id = public._ec_my_fid());
revoke insert, update, delete on public.faction_budget from anon, authenticated;

-- ── 2) Хелперы ──────────────────────────────────────────────
-- Ползунки фракции (дефолт 2/2/2/2/2, если ещё не настраивали).
create or replace function public._budget_row(p_fid text)
returns public.faction_budget language sql stable as $$
  select coalesce(
    (select b from public.faction_budget b where b.faction_id = p_fid),
    row(p_fid, 2,2,2,2,2, now())::public.faction_budget);
$$;

-- Население державы = сумма живого населения колоний (бэкфилл: ячейки×50).
create or replace function public._fac_pop(p_fid text)
returns numeric language sql stable as $$
  select coalesce(sum(coalesce(c.pop, coalesce(c.cells,0)*50)),0)::numeric
  from public.colonies c where c.faction_id = p_fid;
$$;

-- Потолок населения державы = ячейки × 100 (зеркало EC_POP_CAP в economy.js)
create or replace function public._fac_pop_cap(p_fid text)
returns numeric language sql stable as $$
  select coalesce(sum(coalesce(c.cells,0)),0)::numeric * 100
  from public.colonies c where c.faction_id = p_fid;
$$;

-- Прирост населения %/сут от соцобеспечения (зеркало EC_POP_GROWTH в economy.js).
-- Уровень 0 = люди бегут (−2%/сут); «норма» = +1.5%/сут.
create or replace function public._pop_growth(p_lvl int)
returns numeric language sql immutable as $$
  select (array[-0.02, 0.005, 0.015, 0.025, 0.035])[greatest(0,least(4,p_lvl)) + 1]::numeric;
$$;

-- Вес уровня ползунка: цена растёт ПРОГРЕССИВНО — «норма» дешёвая, «максимум»
-- кусается. Зеркало EC_BUDGET_W в economy.js.
create or replace function public._budget_lvl_w(p_lvl int)
returns numeric language sql immutable as $$
  select (array[0, 1, 2, 4, 7])[greatest(0,least(4,p_lvl)) + 1]::numeric;
$$;

-- Ставка ЕДИНАЯ для всех держав (скидка малых держав убрана).
-- Зеркало ecBudgetPopMult в economy.js.
create or replace function public._budget_pop_mult(p_pop numeric)
returns numeric language sql immutable as $$
  select 1::numeric;
$$;

-- Апкип бюджета ГС/сут = население × скидка(население) × Σ(ставка × вес уровня).
-- Ставки НА ДУШУ (зеркало EC_BUDGET.k): industry 0.12 · military 0.15 ·
-- science 0.12 · social 0.12 · infra 0.09. «Норма» по всем = 1.2 ГС/чел до скидки.
create or replace function public._budget_upkeep(p_fid text)
returns numeric language plpgsql stable as $$
declare b public.faction_budget; pop numeric;
begin
  b := public._budget_row(p_fid); pop := public._fac_pop(p_fid);
  return round(pop * public._budget_pop_mult(pop) *
    ( public._budget_lvl_w(b.industry)*0.12 + public._budget_lvl_w(b.military)*0.15
    + public._budget_lvl_w(b.science)*0.12  + public._budget_lvl_w(b.social)*0.12
    + public._budget_lvl_w(b.infra)*0.09 ));
end$$;

-- Благополучие: множитель ВСЕГО ГС-дохода построек от соцобеспечения.
-- (зеркало: EC_BUDGET.social.mults в economy.js)
create or replace function public._budget_gc_mult(p_lvl int)
returns numeric language sql immutable as $$
  select (array[0.85, 0.95, 1.00, 1.08, 1.15])[greatest(0,least(4,p_lvl)) + 1]::numeric;
$$;

-- Множитель ОН от образования (зеркало: EC_BUDGET.science.mults)
create or replace function public._budget_sci_mult(p_lvl int)
returns numeric language sql immutable as $$
  select (array[0.50, 0.80, 1.00, 1.20, 1.40])[greatest(0,least(4,p_lvl)) + 1]::numeric;
$$;

-- Множитель ёмкости склада от инфраструктуры (зеркало: EC_BUDGET.infra.mults)
create or replace function public._budget_cap_mult(p_lvl int)
returns numeric language sql immutable as $$
  select (array[0.80, 0.90, 1.00, 1.15, 1.30])[greatest(0,least(4,p_lvl)) + 1]::numeric;
$$;

-- Целевые слоты постройки по уровню профильного ползунка.
create or replace function public._budget_slot_target(p_lvl int)
returns int language sql immutable as $$
  select (array[1, 2, 3, 5, 6])[greatest(0,least(4,p_lvl)) + 1];
$$;

-- Профильный ползунок постройки: военные → military, наука/разведка →
-- science, остальное (фабрики/торговля/склады/храмы/добыча...) → industry.
create or replace function public._budget_cat(p_btype text)
returns text language sql immutable as $$
  select case
    when p_btype in ('shipyard','military_factory','training','starbase') then 'military'
    when p_btype in ('science','intel') then 'science'
    else 'industry' end;
$$;

-- ── 3) Авто-слоты: население + бюджет определяют ячейки ─────
-- Целевые слоты = уровень профильного ползунка; КАЖДЫЙ СЛОТ ТРЕБУЕТ 3 ЖИТЕЛЕЙ
-- (зеркало EC_POP_PER_SLOT). Не хватает рабочих рук — все постройки срезаются
-- пропорционально (минимум 1).
create or replace function public._budget_auto_slots(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  b public.faction_budget; pop numeric; total_target numeric; scale numeric;
begin
  b := public._budget_row(p_fid);
  pop := public._fac_pop(p_fid);

  select coalesce(sum(public._budget_slot_target(
           case public._budget_cat(cb.btype)
             when 'military' then b.military
             when 'science'  then b.science
             else b.industry end)),0)
    into total_target
  from public.colony_buildings cb where cb.faction_id = p_fid;

  if total_target <= 0 then return; end if;
  scale := least(1.0, pop / (total_target * 3));     -- 3 жителя на слот → срез при нехватке

  update public.colony_buildings cb
     set slots_open = greatest(1, least(6, round(public._budget_slot_target(
           case public._budget_cat(cb.btype)
             when 'military' then b.military
             when 'science'  then b.science
             else b.industry end) * scale)::int))
   where cb.faction_id = p_fid
     and cb.slots_open is distinct from greatest(1, least(6, round(public._budget_slot_target(
           case public._budget_cat(cb.btype)
             when 'military' then b.military
             when 'science'  then b.science
             else b.industry end) * scale)::int));
end$$;

-- ── 4) RPC: выставить бюджет ────────────────────────────────
create or replace function public.budget_set(
  p_industry int, p_military int, p_science int, p_social int, p_infra int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  insert into public.faction_budget(faction_id, industry, military, science, social, infra)
    values (fid,
      greatest(0,least(4,coalesce(p_industry,2))), greatest(0,least(4,coalesce(p_military,2))),
      greatest(0,least(4,coalesce(p_science,2))),  greatest(0,least(4,coalesce(p_social,2))),
      greatest(0,least(4,coalesce(p_infra,2))))
  on conflict (faction_id) do update set
    industry = excluded.industry, military = excluded.military,
    science = excluded.science, social = excluded.social, infra = excluded.infra,
    updated_at = now();
  perform public._budget_auto_slots(fid);      -- слоты пересчитываются сразу
  return jsonb_build_object('ok', true, 'upkeep', public._budget_upkeep(fid));
end$$;
revoke all on function public.budget_set(int,int,int,int,int) from public;
grant execute on function public.budget_set(int,int,int,int,int) to authenticated;

-- ── 5) Ручное открытие слотов ОТКЛЮЧЕНО ─────────────────────
do $$ begin
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'economy_open_slot';
  if found then
    revoke execute on function public.economy_open_slot(uuid) from authenticated;
  end if;
end $$;

-- ── 4a) ЯРУСЫ ДОБЫЧИ: каталог построек ──────────────────────
-- Добывающий завод копает только ПРОСТЫЕ залежи (common).
-- Ценные ярусы требуют своих построек:
--   mining_deep   «Глубинный горный комплекс» — uncommon + rare
--   mining_exotic «Экзотический экстрактор»   — epic + legendary
-- ⚠ КЛОББЕР: _ec_bld_base переопределяется также в _goods_factory /
-- _security_money / _defense_starbase — при перекате тех файлов
-- продублируйте строки «-- ЯРУСЫ:». Зеркало клиента: EC_BUILD/EC_MINE_TIERS.
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'            then 1200
    when 'starbase'         then 5000
    when 'flak'             then 1500
    when 'abm'              then 3000
    when 'goodsfab'         then 1200
    when 'mining_deep'      then 2500   -- ЯРУСЫ: uncommon + rare
    when 'mining_exotic'    then 8000   -- ЯРУСЫ: epic + legendary
    else null end
$$;

-- ЯРУСЫ: допустимые редкости залежей по типу добывающей постройки.
create or replace function public._mine_tier_ok(p_btype text, p_rar text)
returns boolean language sql immutable as $$
  select case p_btype
    when 'mining'        then p_rar = 'common'
    when 'mining_deep'   then p_rar in ('uncommon','rare')
    when 'mining_exotic' then p_rar in ('epic','legendary')
    else false end
$$;

-- КАП: планетарный потолок добычи по ресурсу /сут зависит от РАЗМЕРА месторождения.
-- Самое большое («колоссально») = 35 базово; баффы (m_mine) поднимают кап,
-- но жёсткий потолок 70 (поднято с 20/40 по требованию юзера 2026-07-12:
-- «добыча везде маленькая — поднимем до 70 с баффами»). Зеркало EC_MINE_CAP.
create or replace function public._mine_cap(p_amt text)
returns numeric language sql immutable as $$
  select case btrim(coalesce(p_amt,''))
    when 'колоссально'  then 35
    when 'очень много'  then 28
    when 'много'        then 21
    when 'умеренно'     then 14
    when 'мало'         then 9
    when 'следы'        then 4
    else 14 end           -- нет данных о богатстве → среднее
$$;

-- ── 5a) Ручной выбор «что добывать» ОТКЛЮЧЁН ────────────────
-- Добыча автоматическая (все залежи планеты), маршрутизация — вкладка «Потоки».
do $$ begin
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mining_assign';
  if found then
    revoke execute on function public.mining_assign(uuid, jsonb) from authenticated;
  end if;
end $$;

-- ── 5b) Снос: возврат ½ ТОЛЬКО базы постройки ───────────────
-- Слоты теперь открывает бюджет БЕСПЛАТНО, поэтому старая формула сноса
-- (½ базы + ½ лестницы слотов, _demolish_half_refund.sql) стала бы станком
-- для печати ГС: бюджет открыл 6 слотов → снос «вернул» деньги, которых
-- игрок не платил. Возвращаем ½ базы + ½ незавершённых легаси слот-проектов.
create or replace function public.economy_demolish(p_building_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_btype text; v_slots int; refund numeric := 0; v_slot_refund numeric;
begin
  fid := public._ec_my_fid();
  -- атомарно удаляем СВОЁ здание; параллельные вызовы — только один удалит
  delete from public.colony_buildings
    where id = p_building_id and faction_id = fid
    returning btype, slots_open into v_btype, v_slots;
  if not found then raise exception 'building not found or already demolished'; end if;

  refund := public._ec_build_cost(fid, public._ec_bld_base(v_btype));  -- БЮДЖЕТ: слоты бесплатные, лестница не возвращается

  -- незавершённые слот-проекты этого здания (легаси): удаляем атомарно, суммируем затраты
  with del as (
    delete from public.colony_projects
      where kind = 'slot' and building_id = p_building_id and faction_id = fid
      returning payload
  )
  select coalesce(sum(coalesce((payload->>'spent_gc')::numeric, 0)), 0) into v_slot_refund from del;
  refund := refund + coalesce(v_slot_refund, 0);

  refund := floor(refund / 2);

  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_demolish(uuid) from public;
grant execute on function public.economy_demolish(uuid) to authenticated;

-- ── 6) Военпром: скорость/запрет постройки юнитов ───────────
-- Триггер (а не клоббер RPC заказа): правит ready_at свежего заказа.
create or replace function public._budget_unit_gate()
returns trigger language plpgsql security definer set search_path=public as $$
declare b public.faction_budget; mult numeric;
begin
  b := public._budget_row(new.faction_id);
  if b.military <= 0 then
    raise exception 'military budget is zero: units cannot be built';
  end if;
  mult := (array[null::numeric, 1.5, 1.0, 0.8, 0.65])[b.military + 1];
  if new.ready_at is not null and mult is not null and mult <> 1.0 then
    new.ready_at := now() + (new.ready_at - now()) * mult;
  end if;
  return new;
end$$;
drop trigger if exists trg_budget_unit_gate on public.unit_production;
create trigger trg_budget_unit_gate
  before insert on public.unit_production
  for each row when (new.status = 'queued')
  execute function public._budget_unit_gate();

-- ── 7) economy_accrue v7: бюджет + благополучие ─────────────
-- База: _res_flows.sql v6 (строки -- ВЕРА / -- ВЕРА-2 / -- ВЕРА-4 / -- МУЛЬТИ /
-- -- ПОТОКИ сохранены). Добавленное помечено «-- БЮДЖЕТ:».
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int; d_raw int;  -- БЮДЖЕТ: d_raw = фактический разрыв, d = начисляемый (кап 3 сут)
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;                       -- ВЕРА
  tithe_gc numeric := 0;                             -- ВЕРА-2: десятина основателю
  v_sects int := 0;                                  -- ВЕРА-4: мои активные секты
  sct record; v_ci_host int; v_new_exp numeric;      -- ВЕРА-4: вскрытие чужих сект
  fcfg jsonb := '{}'::jsonb;                         -- ПОТОКИ: настройки по ресурсам
  eff_mode text; v_conc_fid text;                    -- ПОТОКИ
  conc_out jsonb := '{}'::jsonb;                     -- ПОТОКИ: (легаси, доставка концессий удалена)
  k2 text; qty numeric; rcap numeric;                -- ПОТОКИ: (легаси)
  want numeric; extra numeric; store_avail numeric;  -- ПОТОКИ: добор со склада
  lim numeric;                                       -- ПОТОКИ: лимит биржи по ресурсу
  bdg public.faction_budget;                         -- БЮДЖЕТ: ползунки
  bdg_cost numeric := 0;                             -- БЮДЖЕТ: апкип ГС/сут
  w_mult numeric := 1;                               -- БЮДЖЕТ: благополучие (× ГС-доход)
  -- ТОВАРЫ (восстановлено из _goods_factory.sql — клобберилось с _faith_multi)
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1;
  -- КАП ДОБЫЧИ: 50/сут с ПЛАНЕТЫ по ресурсу, заводы НЕ складываются сверх капа
  col_mined jsonb := '{}'::jsonb; ckey text; already numeric; capv numeric;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  -- БЮДЖЕТ: ползунки + благополучие + апкип
  bdg := public._budget_row(p_fid);
  w_mult := public._budget_gc_mult(bdg.social);
  m_gc := m_gc * w_mult;
  bdg_cost := public._budget_upkeep(p_fid);

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d_raw := floor(extract(epoch from (now()-eco.last_tick))/86400.0);
  -- БЮДЖЕТ: КАП ДОБОРА — начисляем максимум за 3 суток; хвост СГОРАЕТ (last_tick
  -- сдвигается на весь d_raw). Иначе первый тик после долгого простоя (или после
  -- применения новой механики) разом высыпает rate×d по каждой залежи до капа
  -- склада — так игроки и получили «тысячи товаров».
  d := least(d_raw, 3);

  if d >= 1 then perform public._budget_auto_slots(p_fid); end if;  -- БЮДЖЕТ: слоты от населения и бюджета
  -- (рост населения — НИЖЕ, после расчёта обеспечения товарами: товары дают бонус к росту)

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);  -- ВЕРА

  -- ПОТОКИ: настройки потоков по ресурсам (одна панель на державу)
  select coalesce(jsonb_object_agg(f.res_name, jsonb_build_object(
      'mode', f.mode, 'market_limit', f.market_limit,
      'market_from_store', f.market_from_store, 'to_store', f.to_store)), '{}'::jsonb)
    into fcfg
  from public.faction_res_flows f where f.faction_id = p_fid;

  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop  -- МУЛЬТИ: + faith_id
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (                                                      -- МУЛЬТИ: доход лишь пока исповедуешь веру храма
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150;  -- ВЕРА
    end if;
  end loop;

  inc_sci := inc_sci * public._budget_sci_mult(bdg.science);   -- БЮДЖЕТ: образование × ОН

  -- ВЕРА-2: если я основатель веры — получаю 20% дохода храмов всех адептов/признавших.
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
      and (cb.faith_id = f.id or cb.faith_id is null)            -- МУЛЬТИ: только храмы этой веры (null=старые)
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  -- ВЕРА-4: доход моих тайных сект (covert temples) — каждая как храм, +150 ГС
  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500)
                 * public._budget_cap_mult(bdg.infra));         -- БЮДЖЕТ: инфраструктура × ёмкость

    -- ВЕРА-4: контрразведка хозяина вскрывает чужие секты на его территории
    if exists(select 1 from public.faith_sects where host_fid = p_fid and status = 'active') then
      v_ci_host := public._spy_ci_power(p_fid, 'hq');
      for sct in select * from public.faith_sects where host_fid = p_fid and status = 'active' loop
        v_new_exp := least(100, sct.exposure + greatest(3, v_ci_host * 12) * d);
        if v_new_exp >= 100 then
          update public.faith_sects set exposure = 100, status = 'exposed', exposed_at = now() where id = sct.id;
          insert into public.faction_relations(from_fid,to_fid,score,updated_at)
            values(p_fid, sct.owner_fid, -10, now())
            on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(p_fid, '🛐 КОНТРРАЗВЕДКА', 'rgba(200,150,40,0.55)', null, null,
              'Вскрыта тайная секта', null,
              format('Контрразведка «%s» раскрыла тайную секту веры «%s», насаждённую фракцией «%s». Ячейка ликвидирована.',
                public._fac_name(p_fid),
                coalesce((select name from public.faiths where id=sct.faith_id),'неизвестной веры'),
                public._fac_name(sct.owner_fid)),
              'approved', now(), now(), now());
        else
          update public.faith_sects set exposure = v_new_exp where id = sct.id;
        end if;
      end loop;
    end if;

    -- БЮДЖЕТ: авто-добыча — завод копает ВСЕ залежи планеты, выбор убран.
    -- ЯРУСЫ: каждая добывающая постройка берёт только залежи своего яруса
    -- (_mine_tier_ok): mining → common, mining_deep → uncommon/rare,
    -- mining_exotic → epic/legendary.
    -- Темп постройки = база(редкость) × доктрина × (слоты/3), потолок КАЖДОЙ постройки =
    -- _mine_cap(размер залежи) × баффы, максимум 70; постройки складываются целиком.
    for bld in
      select cb.colony_id, cb.btype, cb.slots_open, coalesce(cb.mine_mode,'store') as mine_mode,
             c.resources as cres, c.faction_id as col_fid
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype in ('mining','mining_deep','mining_exotic')
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for relem in select value from jsonb_array_elements(bld.cres) loop
        rname := relem->>'name';
        if rname is null then continue; end if;
        -- ЯРУСЫ: у старых снимков колоний поле r бывает пустым — добираем из каталога
        -- resource_rarity, иначе ценная залежь сошла бы за common и досталась заводу.
        rr := coalesce(relem->>'r', (select rarity from public.resource_rarity where name = rname), 'common');
        if not public._mine_tier_ok(bld.btype, rr) then continue; end if;  -- ЯРУСЫ: не тот ярус — пропуск
        -- Темп ОДНОЙ постройки: база по редкости × баффы × (слоты/3). Постройки
        -- СКЛАДЫВАЮТСЯ целиком — каждая копает свой полный темп независимо.
        -- базы подняты ×1.75 вместе с капами (2026-07-12, «добыча везде маленькая»)
        rate := case rr when 'uncommon' then 9 when 'rare' then 5 when 'epic' then 4 when 'legendary' then 2 else 14 end;
        rate := greatest(1, round(rate * m_mine * greatest(1, coalesce(bld.slots_open,1)) / 3.0));
        -- КАП КАЖДОГО ДОМИКА: потолок = размер месторождения (_mine_cap, максимум 35
        -- у «колоссально») × баффы, жёсткий предел 40. Зеркало ecMineYields.
        capv := least(70, greatest(1, round(public._mine_cap(relem->>'amt') * m_mine)));
        rate := least(rate, capv);
        -- ПОТОКИ: концессия = право СТРОИТЬ свои добывающие домики на чужой колонии
        -- (concession_build). Домик на чужой колонии копает ТОЛЬКО залежи, отданные
        -- этой фракции в концессию; владелец колонии отданные залежи НЕ копает.
        if bld.col_fid is distinct from p_fid then
          if not exists(select 1 from public.mining_concessions mc
                        where mc.colony_id = bld.colony_id and mc.res_name = rname
                          and mc.to_fid = p_fid) then
            continue;
          end if;
        elsif exists(select 1 from public.mining_concessions mc
                     where mc.colony_id = bld.colony_id and mc.res_name = rname) then
          continue;
        end if;
        -- ПОТОКИ: режим ресурса из панели потоков перекрывает режим здания
        eff_mode := coalesce(fcfg->rname->>'mode',
                             case when bld.mine_mode = 'export' then 'export' else 'store' end);
        if eff_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add  := jsonb_set(res_add,  array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
          flow_rar := jsonb_set(flow_rar, array[rname], to_jsonb(rr), true);  -- ◄ редкость потока для Товарной биржи
        end if;
      end loop;
    end loop;

    -- ПОТОКИ: доставка «дарового» концессионного потока УДАЛЕНА (2026-07-12):
    -- концессия больше не капает сама — получатель строит СВОИ домики на чужой
    -- колонии (concession_build, _concession_build.sql), и его добыча идёт через
    -- обычный цикл выше как его собственный поток (склад/экспорт/биржа).

    -- ════════ ТОВАРЫ: поток ПОД СПРОС (дематериализованы 2026-07-12) ════════
    -- Товары БОЛЬШЕ НЕ РЕСУРС: не пишутся на склад, не продаются, не копятся.
    -- Фабрика делает РОВНО столько, сколько съедает население за тик
    -- (спрос = pop/600/сут, зеркало EC_GOODS_DEMAND_DIV), и списывает воду/сырьё
    -- ПРОПОРЦИОНАЛЬНО фактическому выпуску (6 воды + 4 сырья на 10 товаров).
    -- Излишка не существует по построению — класс багов «тысячи товаров на
    -- складе / добор за пропущенные дни / слив на биржу» невозможен.
    goods_demand := public._fac_pop(p_fid) / 600.0 * d;
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    if gf_slots > 0 and goods_demand > 0 then
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
    goods_welfare := round(least(1.10, greatest(0.90, 0.90 + 0.20 * goods_cov)), 3);

    -- БЮДЖЕТ: рост населения = соцобеспечение + бонус за товары (до +1%/сут при
    -- полном обеспечении). Потолок ячейки×100, пол ячейки×10, бэкфилл ячейки×50.
    update public.colonies c
       set pop = least(coalesce(c.cells,0)*100,
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           * power(1 + public._pop_growth(bdg.social)
                                     + 0.01 * least(1, goods_cov), d))))
     where c.faction_id = p_fid;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until, from_store from public.trade_routes where status='active' and a_fid=p_fid loop  -- ПОТОКИ: + from_store
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
          want := coalesce((citem->>'vol')::numeric,0)*d;
          shipped := least(want, avail);
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          -- ПОТОКИ: добор недостающего объёма со склада (галочка «брать со склада»)
          if r.from_store and shipped < want then
            store_avail := greatest(0, coalesce((eco.resources->>rname)::numeric,0)
                                       - coalesce((res_sub->>rname)::numeric,0));
            extra := least(want - shipped, store_avail);
            if extra > 0 then
              res_sub := jsonb_set(res_sub, array[rname], to_jsonb(coalesce((res_sub->>rname)::numeric,0) + extra), true);
              shipped := shipped + extra;
            end if;
          end if;
          if shipped <= 0 then continue; end if;
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        want := coalesce(r.volume,0)*d;
        shipped := least(want, avail);
        mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
        -- ПОТОКИ: добор недостающего объёма со склада
        if r.from_store and shipped < want then
          store_avail := greatest(0, coalesce((eco.resources->>r.resource)::numeric,0)
                                     - coalesce((res_sub->>r.resource)::numeric,0));
          extra := least(want - shipped, store_avail);
          if extra > 0 then
            res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0) + extra), true);
            shipped := shipped + extra;
          end if;
        end if;
        if shipped > 0 then
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

    -- товарная биржа (btype=market): сбывает СВЕЖЕДОБЫТЫЙ поток (mine_mode=store) за ГС,
    -- по ценности × доля редкости, до лимита слотов×25/сут, дороже — первым. НАКОПЛЕННЫЙ
    -- СКЛАД НЕ ТРОГАЕТ: раньше биржа перебирала запас по ВСЕМ залежам колоний, и колонизация
    -- новой системы с Гравиядром/Стелларитом разом сливала стратегический резерв (вкл. топливо
    -- Длани). Теперь продаётся только поток этого тика; всё, что не продано, копится на складе.
    -- ПОТОКИ: сверху — персональный лимит market_limit/сут на ресурс и явный добор
    -- со склада market_from_store/сут (по умолчанию 0 — склад по-прежнему не трогается).
    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      -- ТОВАРЫ: автопродажа излишка УДАЛЕНА (2026-07-12) — излишка больше нет,
      -- фабрика производит ровно под спрос населения (см. блок выше).
      for r in
        select t.nm as res_name, coalesce(flow_rar->>t.nm,'common') as res_rar,
               coalesce((res_add->>t.nm)::numeric,0) as avail
        from jsonb_object_keys(res_add) as t(nm)
        where t.nm <> 'Товары' and coalesce((res_add->>t.nm)::numeric,0) > 0   -- ТОВАРЫ: страховка, в поток не попадают
        order by public._res_value(t.nm, coalesce(flow_rar->>t.nm,'common')) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        lim := nullif(fcfg->r.res_name->>'market_limit','')::numeric;     -- ПОТОКИ
        if lim is not null then sell := least(sell, lim * d); end if;     -- ПОТОКИ: лимит /сут
        if sell <= 0 then continue; end if;
        -- вычитаем проданное из ПОТОКА (не со склада) — на склад ляжет только остаток
        res_add := jsonb_set(res_add, array[r.res_name],
                     to_jsonb(coalesce((res_add->>r.res_name)::numeric,0) - sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      -- ПОТОКИ: явный добор со склада (market_from_store ед./сут по ресурсу)
      for r in
        select f.res_name, f.market_from_store from public.faction_res_flows f
        where f.faction_id = p_fid and f.market_from_store > 0
        order by public._res_value(f.res_name,
          coalesce((select rarity from public.resource_rarity where name=f.res_name),'common')) desc
      loop
        exit when market_cap <= 0;
        store_avail := greatest(0, coalesce((eco.resources->>r.res_name)::numeric,0)
                                   - coalesce((res_sub->>r.res_name)::numeric,0));
        sell := least(r.market_from_store * d, store_avail, market_cap);
        if sell <= 0 then continue; end if;
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        rr := coalesce((select rarity from public.resource_rarity where name=r.res_name),'common');
        market_gc := market_gc + sell * public._res_value(r.res_name, rr) *
          (case rr when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      -- ПОТОКИ: перелив на склад выключен — остаток потока авто-продаётся как экспорт (×0.6)
      if coalesce(fcfg->k->>'to_store','true') = 'false' then
        export_gc := export_gc + round(greatest(0,(res_add->>k)::numeric)
          * public._res_value(k, coalesce(flow_rar->>k,'common')) * 0.6 * m_gc);
        continue;
      end if;
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - policy_cost * d - bdg_cost * d),  -- БЮДЖЕТ: апкип · ТОВАРЫ: × welfare
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d_raw || ' days')::interval  -- БЮДЖЕТ: сдвиг на ВЕСЬ разрыв — хвост сверх капа сгорает
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * goods_welfare * d), trade_gc, market_gc, export_gc, (policy_cost + bdg_cost) * d,  -- БЮДЖЕТ: апкип в расходах
        round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - (policy_cost + bdg_cost) * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        (select coalesce(sum(value::numeric),0) from jsonb_each_text(res_add)));
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'goods', jsonb_build_object('demand', round(goods_demand),  -- ТОВАРЫ: поток под спрос, без склада/биржи
       'coverage', goods_cov, 'welfare', goods_welfare, 'made', round(gf_made), 'ratio', gf_ratio),
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc * goods_welfare),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate,
      'budget', bdg_cost),                                             -- БЮДЖЕТ: апкип ГС/сут
    'budget', jsonb_build_object(                                       -- БЮДЖЕТ: ползунки для клиента
      'industry', bdg.industry, 'military', bdg.military, 'science', bdg.science,
      'social', bdg.social, 'infra', bdg.infra,
      'pop', public._fac_pop(p_fid), 'pop_cap', public._fac_pop_cap(p_fid),
      'growth', public._pop_growth(bdg.social),
      'upkeep', bdg_cost, 'w_mult', w_mult));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка после применения ───────────────────────────────
-- select public.budget_set(3, 0, 2, 4, 2);   -- военка 0: заказ юнита должен падать
-- select public.economy_accrue('<fid>');     -- в ответе ключ budget + income.budget
-- select slots_open, btype from public.colony_buildings where faction_id='<fid>';
