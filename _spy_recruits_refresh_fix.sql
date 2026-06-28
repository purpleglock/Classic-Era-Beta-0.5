-- _spy_recruits_refresh_fix.sql — рынок рекрутов НЕ пополняется при опустошении наймом
-- ════════════════════════════════════════════════════════════════════════
-- БАГ: spy_recruits_list решал «сколько подвезти» по ЧИСЛУ рекрутов в пуле:
--   if v_cnt = 0 then n_replace := 4;  → наняв ВСЕХ, игрок опустошал пул,
--   функция считала это «первым заходом» и мгновенно генерила 4 новых.
--   Дневной лимит обходился: нанял 4 → пул пуст → снова 4 → бесконечно.
--
-- ФИКС: гейтим обновление по МЕТКЕ ВРЕМЕНИ последнего подвоза
--   (faction_economy.spy_recruits_refreshed_at), а не по остатку пула.
--   Опустошение наймом больше НЕ триггерит регенерацию — пул ждёт суток.
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _spy_fleet_ops.sql (там жил дневной spy_recruits_list).
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════

-- метка последнего подвоза рекрутов
alter table public.faction_economy
  add column if not exists spy_recruits_refreshed_at timestamptz;

-- backfill: чтобы существующие пулы не пересоздались сразу, ставим метку = время
-- новейшего текущего рекрута (или now(), если пул пуст/новый игрок)
update public.faction_economy fe
  set spy_recruits_refreshed_at = coalesce(
        (select max(created_at) from public.spy_recruits sr where sr.faction_id = fe.faction_id),
        now())
  where spy_recruits_refreshed_at is null;

create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_refreshed timestamptz; v_cnt int; i int; n_replace int;
  v_seed boolean := false; v_daily boolean := false; rid uuid;
  fn text; ln text; pk text; rc text; gn text; rp text; frace text; nm jsonb;
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

  -- РЕШЕНИЕ по МЕТКЕ ВРЕМЕНИ, а не по остатку пула:
  --   первый раз (метки нет)        → засеять до 4;
  --   прошли сутки                  → заменить 1–3 старейших и добить до 4;
  --   иначе (в т.ч. опустошён наймом)→ НИЧЕГО (пул ждёт следующих суток).
  if v_refreshed is null then
    v_seed := true;
  elsif v_refreshed < now() - interval '1 day' then
    v_daily := true;
  end if;

  if v_seed or v_daily then
    if v_daily and v_cnt > 0 then
      n_replace := 1 + floor(random()*3)::int;          -- 1..3 старейших на выход
      for rid in select id from public.spy_recruits where faction_id=fid order by created_at asc limit n_replace loop
        delete from public.spy_recruits where id=rid;
      end loop;
    end if;
    -- добрать до 4
    select count(*) into v_cnt from public.spy_recruits where faction_id=fid;
    for i in 1..(4 - v_cnt) loop
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
    update public.faction_economy set spy_recruits_refreshed_at = now() where faction_id=fid;
    v_refreshed := now();
  end if;

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
    -- следующий «дневной» подвоз = метка последнего обновления + сутки (стабильный отсчёт)
    'refresh_at', v_refreshed + interval '1 day',
    'counterintel', public.spy_counter_list());
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── ПРОВЕРКА ─────────────────────────────────────────────────────────────
-- Нанять всех 4 рекрутов → пул ПУСТ и остаётся пустым до истечения суток
-- (spy_recruits_refreshed_at + 1 day). Через сутки следующий вызов добьёт до 4.
