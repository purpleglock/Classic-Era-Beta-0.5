-- ============================================================
-- ГЕЙТЫ ПРАВ: обёртки над серверными RPC
-- Применять: node tools/db_run.js _fm_gates.sql   (ПОСЛЕ _faction_members.sql)
--
-- Как это работает и почему так. Тела боевых RPC живут в базе и местами
-- новее файлов репозитория — перекатывать их ради одной строчки проверки
-- нельзя. Поэтому оригинал ПЕРЕИМЕНОВЫВАЕТСЯ в <имя>__raw (тело не
-- трогаем), а на его место встаёт сгенерированная обёртка той же
-- сигнатуры: сначала _fm_gate('право', 'вид объекта', ссылка), потом
-- вызов оригинала. Право на выполнение __raw у клиентских ролей
-- отзывается — обойти обёртку через PostgREST нельзя.
--
-- Идемпотентно: уже обёрнутые функции пропускаются. Если оригинал позже
-- перезальют старым файлом (CREATE OR REPLACE поверх обёртки) — просто
-- прогнать этот файл ещё раз, осиротевший __raw подчистится сам.
-- ============================================================

create or replace function public._fm_wrap(
  p_name text, p_code text, p_kind text default null, p_arg text default null)
returns void language plpgsql as $fn$
declare
  oids oid[]; o oid; r record; raw text;
  callargs text; ret text; vol text; body text; refexpr text; kindexpr text;
  wrapped boolean;
begin
  raw := p_name || '__raw';
  wrapped := exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = p_name and p.prosrc like '%_fm_gate%');

  -- Осиротевший __raw (обёртку затёрли перезаливкой оригинала) — убираем.
  if not wrapped then
    for r in select pg_get_function_identity_arguments(p.oid) ia
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = raw loop
      execute format('drop function if exists public.%I(%s)', raw, r.ia);
    end loop;
  end if;

  select coalesce(array_agg(p.oid), '{}') into oids
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_name and p.prokind = 'f'
     and p.prosrc not like '%_fm_gate%';

  if array_length(oids, 1) is null then
    raise notice 'fm_wrap: функции public.% нет — пропуск', p_name; return;
  end if;

  foreach o in array oids loop
    select p.proretset, p.provolatile, p.prosecdef, p.proargnames,
           pg_get_function_arguments(p.oid)          as fargs,
           pg_get_function_identity_arguments(p.oid) as ia,
           pg_get_function_result(p.oid)             as fres
      into r from pg_proc p where p.oid = o;

    if r.fargs ~* '(^|,)\s*(out|inout|variadic)\s' then
      raise notice 'fm_wrap: %(%) — OUT/VARIADIC, пропуск', p_name, r.ia; continue;
    end if;
    if not r.prosecdef then
      raise notice 'fm_wrap: %(%) — не SECURITY DEFINER, пропуск', p_name, r.ia; continue;
    end if;

    select coalesce(string_agg(quote_ident(nm), ', ' order by ord), '')
      into callargs from unnest(coalesce(r.proargnames, '{}')) with ordinality t(nm, ord);
    if r.fargs <> '' and callargs = '' then
      raise notice 'fm_wrap: %(%) — безымянные аргументы, пропуск', p_name, r.ia; continue;
    end if;

    kindexpr := case when p_kind is null then 'null'
                     when p_arg is not null and p_arg = any(coalesce(r.proargnames, '{}'))
                       then quote_literal(p_kind) else 'null' end;
    refexpr  := case when kindexpr = 'null' then 'null'
                     else quote_ident(p_arg) || '::text' end;

    ret := r.fres;
    vol := case r.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end;
    if ret = 'void' then
      body := format('perform public.%I(%s); return;', raw, callargs);
    elsif r.proretset then
      body := format('return query select * from public.%I(%s);', raw, callargs);
    else
      body := format('return public.%I(%s);', raw, callargs);
    end if;

    execute format('alter function public.%I(%s) rename to %I', p_name, r.ia, raw);
    execute format($f$create function public.%I(%s) returns %s
      language plpgsql %s security definer set search_path=public as $w$
begin
  perform public._fm_gate(%L, %s, %s);
  %s
end$w$$f$, p_name, r.fargs, ret, vol, p_code, kindexpr, refexpr, body);

    -- Оригинал уводим из-под клиентов: вызвать в обход обёртки нельзя.
    execute format('revoke all on function public.%I(%s) from public', raw, r.ia);
    begin execute format('revoke all on function public.%I(%s) from anon, authenticated', raw, r.ia);
    exception when others then null; end;
    begin execute format('grant execute on function public.%I(%s) to authenticated, anon, service_role', p_name, r.ia);
    exception when others then null; end;
  end loop;
end$fn$;

-- ============================================================
-- КАРТА: что каким правом закрыто и к какому объекту привязано
--   вид объекта: 'sys' (система), 'colony' (колония → её система),
--   'bld' (постройка → её система), 'fleet', 'army'
-- ============================================================
do $map$
declare w text[][];
begin
  w := array[
    -- ── Строительство ─────────────────────────────────────
    ['economy_build','build','colony','p_colony_id'],
    ['economy_demolish','build','bld','p_building_id'],
    ['economy_set_mine_mode','build','bld','p_building_id'],
    ['economy_set_tnp','build','bld','p_building_id'],
    ['nemesis_build','build','colony','p_colony_id'],
    ['shellforge_build','build','colony','p_colony_id'],
    ['ballfab_build','build','colony','p_colony_id'],
    ['concession_build','build',null,null],
    ['concession_slot_buy','build','colony','p_colony'],
    ['resource_priority_set','build','colony','p_colony'],
    ['resource_priority_set_system','build','sys','p_system'],
    -- ── Колонизация и территория ──────────────────────────
    ['economy_colonize','colonize','sys','p_system_id'],
    ['economy_build_station','colonize','sys','p_system_id'],
    ['economy_terraform','colonize','sys','p_system_id'],
    ['economy_habitat','colonize','colony','p_colony_id'],
    ['economy_abandon','colonize','colony','p_colony_id'],
    ['economy_claim_system','colonize','sys','p_system_id'],
    ['rename_colony','colonize','colony','p_colony_id'],
    ['colony_rename_paid','colonize','colony','p_colony_id'],
    -- ── Производство ──────────────────────────────────────
    ['economy_produce','produce',null,null],
    ['economy_produce_coupon','produce',null,null],
    ['economy_cancel_production','produce',null,null],
    ['unit_scrap','produce',null,null],
    ['shipyard_repair','produce',null,null],
    ['shell_order','produce','bld','p_building_id'],
    -- ── Конструкторы ──────────────────────────────────────
    ['economy_publish_unit','design',null,null],
    ['turret_upsert','design',null,null],
    ['turret_delete','design',null,null],
    ['reactor_upsert','design',null,null],
    ['reactor_delete','design',null,null],
    ['armor_alloy_upsert','design',null,null],
    ['armor_alloy_delete','design',null,null],
    -- ── Наука ─────────────────────────────────────────────
    ['economy_research','research',null,null],
    ['economy_research_queue','research',null,null],
    ['research_drain_queue','research',null,null],
    ['tech_offer_propose','research',null,null],
    ['tech_offer_accept','research',null,null],
    ['tech_offer_reject','research',null,null],
    ['tech_offer_cancel','research',null,null],
    ['tech_layout_set','research',null,null],
    ['tech_layout_reset','research',null,null],
    ['tech_prereq_set','research',null,null],
    ['tech_prereq_reset','research',null,null],
    -- ── Корпорации ────────────────────────────────────────
    ['corp_create','corp',null,null],
    ['corp_edit','corp',null,null],
    ['corp_dissolve','corp',null,null],
    ['corp_recompose','corp',null,null],
    ['corp_building_set','corp',null,null],
    ['corp_list_shares','corp',null,null],
    ['corp_cancel_listing','corp',null,null],
    -- ── Рынок и биржа ─────────────────────────────────────
    ['market_buy_resource','market',null,null],
    ['market_sell_resource','market',null,null],
    ['market_autosell_set','market',null,null],
    ['res_sell_now','market',null,null],
    ['order_create','market',null,null],
    ['order_cancel','market',null,null],
    ['order_fulfill','market',null,null],
    ['bond_issue','market',null,null],
    ['bond_buy','market',null,null],
    ['bond_cancel','market',null,null],
    ['futures_open','market',null,null],
    ['futures_close','market',null,null],
    ['margin_open','market',null,null],
    ['margin_close','market',null,null],
    ['options_buy','market',null,null],
    ['options_close','market',null,null],
    ['corp_buy_shares','market',null,null],
    -- ── Казна и курс державы ──────────────────────────────
    ['budget_set','treasury',null,null],
    ['econ_policy_set','treasury',null,null],
    ['resource_rarity_policy_set','treasury',null,null],
    ['resource_worker_plan','treasury',null,null],
    ['goods_recipe_set','treasury',null,null],
    ['loan_verdict','treasury',null,null],
    ['geosurvey_spin','treasury',null,null],
    ['geosurvey_accept','treasury',null,null],
    ['stargaze_start','treasury',null,null],
    ['stargaze_pick','treasury',null,null],
    ['fc_bet','treasury',null,null],
    -- ── Торговля и потоки ─────────────────────────────────
    ['res_flow_set','trade',null,null],
    ['res_flow_clear','trade',null,null],
    ['trade_route_from_store','trade',null,null],
    ['concession_grant','trade',null,null],
    ['concession_revoke','trade',null,null],
    ['sinli_buy','trade',null,null],
    ['sinli_sell','trade',null,null],
    -- ── Флот ──────────────────────────────────────────────
    ['fleet_form','fleet','sys','p_system_id'],
    ['fleet_edit','fleet','fleet','p_id'],
    ['fleet_disband','fleet','fleet','p_id'],
    ['fleet_send','fleet','fleet','p_id'],
    ['fleet_recall','fleet','fleet','p_id'],
    ['fleet_raid','fleet','fleet','p_fleet_id'],
    ['fleet_raid_colony','fleet','fleet','p_fleet_id'],
    ['outpost_ship_build','fleet','sys','p_system_id'],
    ['outpost_ship_deploy','fleet',null,null],
    ['outpost_ship_send','fleet',null,null],
    ['outpost_ship_scrap','fleet',null,null],
    ['raid_launch','fleet',null,null],
    ['raid_scout','fleet',null,null],
    ['raid_policy_set','fleet',null,null],
    ['raid_patrol_set','fleet',null,null],
    -- ── Армии ─────────────────────────────────────────────
    ['army_form','army','colony','p_colony_id'],
    ['army_disband','army','army','p_id'],
    ['army_send','army','army','p_id'],
    ['army_recall','army','army','p_id'],
    -- ── Тактический бой ───────────────────────────────────
    ['battle_deploy','battle',null,null],
    ['battle_ready','battle',null,null],
    ['battle_move','battle',null,null],
    ['battle_fire','battle',null,null],
    ['battle_module','battle',null,null],
    ['battle_launch','battle',null,null],
    ['battle_stance','battle',null,null],
    ['battle_end_turn','battle',null,null],
    ['battle_reinforce','battle',null,null],
    ['battle_force_turn','battle',null,null],
    -- ── Стратегический удар ───────────────────────────────
    ['mza_fire','strike',null,null],
    ['doom_fire','strike',null,null],
    ['doom_set_duel','strike',null,null],
    ['subspace_volley','strike',null,null],
    ['abm_set_defense','strike',null,null],
    -- ── Оборона и аванпосты ───────────────────────────────
    ['mza_build','defense','sys','p_system_id'],
    ['mza_scrap','defense',null,null],
    ['doom_build','defense','colony','p_colony_id'],
    ['subspace_build','defense','sys','p_system_id'],
    ['guardian_build','defense','sys','p_system_id'],
    ['guardian_scrap','defense',null,null],
    ['dronepost_build','defense','sys','p_system_id'],
    ['dronepost_scrap','defense','sys','p_system_id'],
    ['sysmine_lay','defense','sys','p_system_id'],
    ['sysmine_clear','defense','sys','p_system_id'],
    ['minefield_clear','defense',null,null],
    ['outpost_build','defense','sys','p_system_id'],
    ['outpost_dismantle','defense',null,null],
    ['outpost_set_mode','defense',null,null],
    ['outpost_set_resource','defense',null,null],
    ['station_deploy','defense','sys','p_system_id'],
    ['intel_guard_set','defense','sys','p_system_id'],
    -- ── Дипломатия ────────────────────────────────────────
    ['union_create','diplo',null,null],
    ['union_edit','diplo',null,null],
    ['union_invite','diplo',null,null],
    ['union_invite_respond','diplo',null,null],
    ['union_leave','diplo',null,null],
    ['vassal_propose','diplo',null,null],
    ['vassal_respond','diplo',null,null],
    ['vassal_break','diplo',null,null],
    ['borders_set','diplo',null,null],
    ['faith_offer_recognition','diplo',null,null],
    ['faith_offer_respond','diplo',null,null],
    ['stargaze_patron_set','diplo',null,null],
    ['news_react','diplo',null,null],
    -- ── Война ─────────────────────────────────────────────
    ['war_declare','war',null,null],
    ['war_join','war',null,null],
    ['war_call_ally','war',null,null],
    ['war_offer_make','war',null,null],
    ['war_offer_respond','war',null,null],
    ['war_offer_withdraw','war',null,null],
    -- ── Разведка ──────────────────────────────────────────
    ['spy_hire','spy',null,null],
    ['spy_launch','spy',null,null],
    ['spy_fleet_op','spy',null,null],
    ['spy_mission','spy',null,null],
    ['spy_cancel','spy',null,null],
    ['spy_train','spy',null,null],
    ['spy_investigate','spy',null,null],
    ['spy_agent_fire','spy',null,null],
    ['spy_artifact_equip','spy',null,null],
    ['spy_artifact_unequip','spy',null,null],
    ['spy_captive_execute','spy',null,null],
    ['spy_captive_ransom','spy',null,null],
    ['spy_captive_recruit','spy',null,null],
    ['spy_captive_return','spy',null,null],
    ['spy_case_open','spy',null,null],
    ['spy_case_method','spy',null,null],
    ['spy_case_accuse','spy',null,null],
    ['spy_ransom_accept','spy',null,null],
    ['spy_ransom_decline','spy',null,null],
    ['spy_steal_slaves','spy',null,null],
    -- ── Вера ──────────────────────────────────────────────
    ['faith_found','faith',null,null],
    ['faith_edit','faith',null,null],
    ['faith_join','faith',null,null],
    ['faith_leave','faith',null,null],
    ['faith_monument_build','faith','colony','p_colony_id'],
    ['faith_monument_edit','faith',null,null],
    -- ── Депеши ────────────────────────────────────────────
    ['news_announce_ach','news',null,null],
    -- ── Клуб ──────────────────────────────────────────────
    ['fc_signup','fleet',null,null]
  ];
  for i in 1 .. array_length(w, 1) loop
    perform public._fm_wrap(w[i][1], w[i][2], w[i][3], w[i][4]);
  end loop;
end$map$;

notify pgrst, 'reload schema';
