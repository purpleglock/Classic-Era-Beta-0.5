-- _spy_recruits_market_fix.sql — рынок рекрутов: убывает при найме, копится по таймеру
-- ════════════════════════════════════════════════════════════════════════
-- ИСТОРИЯ:
--   1) _spy_recruits_refresh_fix.sql повесил пополнение на гейт «прошли сутки»
--      → наняв партию, сидишь сутки без рекрутов даже при свободных слотах.
--   2) первая версия этого файла лила по СУТОЧНОМУ БЮДЖЕТУ (8/сут) и доливала
--      витрину до 4 на КАЖДОМ заходе → найм мгновенно восстанавливался,
--      пул «не заканчивался» (ощущение бесконечного рынка).
--
-- ЧТО НАДО: пул УБЫВАЕТ по мере найма и ПОПОЛНЯЕТСЯ ПО ТАЙМЕРУ, не мгновенно.
--
-- ФИКС: КАПЕЛЬНЫЙ подвоз. Витрина держит до c_target=4 рекрутов; пока их
--   меньше, раз в c_interval (8 ч) подвозят +1 (накопившиеся за долгое
--   отсутствие интервалы добиваются разом, но БЕЗ банкинга — метку всегда
--   двигаем в now(), поэтому опустошить-и-мгновенно-наполнить нельзя).
--   refresh_at = время следующей «капли» (или null, когда витрина полна).
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _spy_recruits_refresh_fix.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════

-- метка времени последнего подвоза (если refresh-fix не накатывали — заведём тут)
alter table public.faction_economy
  add column if not exists spy_recruits_refreshed_at timestamptz;

create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_refreshed timestamptz; v_cnt int; i int;
  n_add int; n_intervals int;
  fn text; ln text; pk text; rc text; gn text; rp text; frace text; nm jsonb; v_next timestamptz;
  -- настройки рынка
  c_target   constant int      := 4;                -- максимум рекрутов на витрине
  c_interval constant interval := interval '8 hours';-- темп подвоза: +1 свежий раз в N (пока < target)
  perks       text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
  repls       text[] := array['Оригинал','Оригинал','Оригинал','Клон','Репликант'];
  all_races   text[] := array['Гуманоиды','Млекопитающие','Рептилоиды','Авианы (Птицеподобные)',
                              'Инсектоиды','Акватики (Водные)','Плантоиды (Растениевидные)',
                              'Литоиды (Каменные)','Синтетики / Киборги','Энергетические сущности'];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid(); uid := auth.uid();
  select race into frace from public.faction_applications
    where faction_id=fid and status='approved' order by updated_at desc limit 1;
  if frace is null then
    select race into frace from public.faction_applications
      where faction_id=fid order by updated_at desc limit 1;
  end if;

  select spy_recruits_refreshed_at into v_refreshed from public.faction_economy where faction_id=fid;
  select count(*) into v_cnt from public.spy_recruits where faction_id=fid;

  -- сколько подвезти ПРЯМО СЕЙЧАС
  if v_refreshed is null then
    n_add := greatest(0, c_target - v_cnt);          -- первый заход: засеять витрину до отказа
  elsif v_cnt < c_target then
    n_intervals := floor(extract(epoch from (now() - v_refreshed)) / extract(epoch from c_interval))::int;
    n_add := least(greatest(0, c_target - v_cnt), greatest(0, n_intervals));  -- по 1 за интервал, добор за простой
  else
    n_add := 0;                                       -- витрина полна — ждём, пока нанимут
  end if;

  if n_add > 0 then
    for i in 1..n_add loop
      if frace is not null and random() < 0.45 then
        rc := frace;
      else
        rc := all_races[1 + floor(random()*array_length(all_races,1))::int];
      end if;
      nm := public._spy_gen_name(rc);
      fn := nm->>'fn'; ln := nm->>'ln'; gn := nm->>'gn';
      pk := perks[1 + floor(random()*array_length(perks,1))::int];
      rp := repls[1 + floor(random()*array_length(repls,1))::int];
      insert into public.spy_recruits(faction_id, owner_id, first_name, last_name, perk, cost, race, gender, replication)
        values(fid, uid, fn, ln, pk, public._spy_perk_cost(pk) + floor(random()*200), rc, gn, rp);
    end loop;
    select count(*) into v_cnt from public.spy_recruits where faction_id=fid;
    v_refreshed := now();                             -- сброс метки = анти-банкинг (нельзя копить подвозы)
    -- пишем в БД ТОЛЬКО когда реально подвезли (бережём Disk I/O — зовётся часто)
    update public.faction_economy set spy_recruits_refreshed_at = v_refreshed where faction_id=fid;
  end if;

  -- следующая «капля» — только пока витрина не полна
  v_next := case when v_cnt < c_target then coalesce(v_refreshed, now()) + c_interval else null end;

  return jsonb_build_object(
    'cap',   public._spy_agent_cap(fid),
    'hired', (select count(*) from public.spy_agents where faction_id=fid and coalesce(captive,false)=false),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'ready_at',a.ready_at,
                'race',a.race,'gender',a.gender,'replication',a.replication,
                'level',coalesce(a.level,1),'xp',coalesce(a.xp,0),
                'xp_floor',public._spy_xp_floor(coalesce(a.level,1)),
                'xp_next', case when coalesce(a.level,1) >= 5 then null
                                else public._spy_xp_floor(coalesce(a.level,1)+1) end,
                'arts',(select coalesce(jsonb_agg(art.kind order by art.acquired_at),'[]'::jsonb)
                        from public.spy_artifacts art where art.equipped_agent=a.id),
                'ci_role',(select ci.role from public.faction_counterintel ci where ci.faction_id=fid and ci.agent_id=a.id),
                'status', case when a.ready_at > now() then 'training'
                               when exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? a.id::text) then 'busy'
                               else 'ready' end) order by a.hired_at), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=false),
    'prisoners',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'level',coalesce(a.level,1),
                'race',a.race,'gender',a.gender,'replication',a.replication,
                'orig_fid',a.orig_fid,'orig_name',public._fac_name(a.orig_fid),
                'captured_at',a.captured_at,
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=true),
    'captured',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'level',coalesce(a.level,1),
                'captor_fid',a.faction_id,'captor_name',public._fac_name(a.faction_id),
                'ransom_id',(select r.id from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1),
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.orig_fid=fid and coalesce(a.captive,false)=true),
    'artifacts',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',x.id,'kind',x.kind,'equipped_agent',x.equipped_agent) order by x.acquired_at), '[]'::jsonb)
              from public.spy_artifacts x where x.faction_id=fid),
    'recruits',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk,'cost',cost,
                'race',race,'gender',gender,'replication',replication) order by cost), '[]'::jsonb)
              from public.spy_recruits where faction_id=fid),
    -- время следующего подвоза (+1 рекрут); null, когда витрина полна
    'refresh_at', v_next,
    'counterintel', public.spy_counter_list());
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── РАЗОВАЯ ПЕРЕЗАГРУЗКА ВИТРИН ───────────────────────────────────────────
-- сбрасываем метку → у всех на следующем заходе витрина дозасеется до 4,
-- а дальше тает при найме и капает по таймеру.
update public.faction_economy set spy_recruits_refreshed_at = null;

-- ── ПРОВЕРКА ─────────────────────────────────────────────────────────────
-- 1) Открыть рынок → до 4 рекрутов.
-- 2) Нанять одного → их 3, БЕЗ мгновенного долива; таймер «через 8 ч» тикает.
-- 3) Подождать интервал (или подвинуть spy_recruits_refreshed_at в прошлое) →
--    +1 свежий. Опустошить и тут же наполнить НЕЛЬЗЯ — метка сброшена в now().
