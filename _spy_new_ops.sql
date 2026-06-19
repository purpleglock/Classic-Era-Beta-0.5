-- ============================================================
-- ШПИОНАЖ · НОВЫЕ ОПЕРАЦИИ: КРАЖА РЕСУРСОВ, МАССОВЫЙ СНОС, ЛИКВИДАЦИЯ
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_impose.sql. Идемпотентно.
--
--  steal_res     diff 28  base 2  need basic  — украсть сырьё со склада цели
--  mass_demolish diff 45  base 3  need deep   — снести N зданий (≥2 агента, N=agents, max 5)
--  kill_agent    diff 38  base 2  need basic  — ликвидировать готового агента цели
-- ============================================================

-- ── 1. Каталог операций ──────────────────────────────────────
create or replace function public._spy_op_meta(p_op text)
returns jsonb language sql immutable as $$
  select case p_op
    when 'recon_basic'    then '{"diff":0,"base":1,"need":"","recon":"basic"}'::jsonb
    when 'recon_deep'     then '{"diff":15,"base":2,"need":"","recon":"deep"}'::jsonb
    when 'steal_gc'       then '{"diff":25,"base":2,"need":"basic"}'::jsonb
    when 'steal_res'      then '{"diff":28,"base":2,"need":"basic"}'::jsonb
    when 'sabotage'       then '{"diff":30,"base":2,"need":"deep"}'::jsonb
    when 'destabilize'    then '{"diff":35,"base":3,"need":"basic"}'::jsonb
    when 'kill_agent'     then '{"diff":38,"base":2,"need":"basic"}'::jsonb
    when 'steal_tech'     then '{"diff":45,"base":4,"need":"deep"}'::jsonb
    when 'mass_demolish'  then '{"diff":45,"base":3,"need":"deep"}'::jsonb
    when 'faith_impose'   then '{"diff":28,"base":3,"need":"basic"}'::jsonb
    else null end
$$;

-- ── 2. spy_launch ────────────────────────────────────────────
-- База: _faith_impose.sql. Добавлены проверки для трёх новых операций.
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b int; det_b int; v_colony uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;

  -- faith_impose: нужна своя вера и цель без веры
  if p_op = 'faith_impose' then
    if not exists(select 1 from public.faith_membership where faction_id=app.faction_id) then
      raise exception 'you follow no faith to spread'; end if;
    if exists(select 1 from public.faith_membership where faction_id=p_target_fid) then
      raise exception 'target already follows a faith'; end if;
  end if;

  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;

  -- операции, требующие сети (≥2 агента)
  if p_op in ('steal_tech','mass_demolish') and a < 2 then
    raise exception 'this op needs a network: at least 2 agents'; end if;

  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  -- саботаж и массовый снос могут бить по конкретной колонии
  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  -- перк-бонусы (зеркало _spy_resolve)
  select coalesce(sum(case
    when ag.perk='infiltrator' and p_op in ('steal_gc','steal_tech','steal_res') then 12
    when ag.perk='saboteur'    and p_op in ('sabotage','destabilize','mass_demolish') then 12
    when ag.perk='analyst'     and p_op in ('recon_basic','recon_deep') then 10
    when ag.perk='ghost'       and p_op = 'kill_agent' then 8
    else 0 end),0),
  coalesce(sum(case when ag.perk='ghost' then 10 else 0 end),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  diff := (meta->>'diff')::numeric;
  -- КР по области: колония для саботажа/сноса, иначе Центр
  if p_op in ('sabotage','mass_demolish') and v_colony is not null then
    ci := public._spy_ci_power(p_target_fid, v_colony::text);
  else
    ci := public._spy_ci_power(p_target_fid, 'hq');
  end if;
  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);
  succ := greatest(5,  least(95, round(45 + a*8 + ibonus + spow - diff - ci*9 + succ_b)));
  det  := greatest(2,  least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;

-- ── 3. _spy_resolve ──────────────────────────────────────────
-- База: _faith_impose.sql. Добавлены ветки steal_res / mass_demolish / kill_agent.
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy; v_colname text;
  v_faith uuid; v_faith_name text;
  v_res_name text; v_res_have numeric; v_res_steal numeric;
  v_n_destroy int; v_i int;
  v_kill_id uuid; v_kill_name text;
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
      -- ── разведка ──
      if m.op in ('recon_basic','recon_deep') then
        res := jsonb_build_object('gc',tgt.gc,'science',tgt.science,
          'agents',(select count(*) from public.spy_agents where faction_id=m.target_fid and ready_at<=now()),
          'colonies',(select count(*) from public.colonies where faction_id=m.target_fid),
          'buildings',(select count(*) from public.colony_buildings where faction_id=m.target_fid));
        res := res || jsonb_build_object('colony_list', (
          select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.planet_name,
              'buildings', case when m.op='recon_deep'
                then (select coalesce(jsonb_agg(distinct cb.btype), '[]'::jsonb) from public.colony_buildings cb where cb.colony_id=c.id)
                else null end) order by c.created_at), '[]'::jsonb)
          from public.colonies c where c.faction_id=m.target_fid));
        if m.op='recon_deep' then res := res || jsonb_build_object(
          'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=m.target_fid and status='done'),
          'research',(select coalesce(jsonb_array_length(research),0) from public.faction_economy where faction_id=m.target_fid)); end if;

      -- ── кража казны ──
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);

      -- ── кража ресурсов ──
      elsif m.op='steal_res' then
        select key into v_res_name from jsonb_each_text(coalesce(tgt.resources,'{}'))
          where value::numeric > 0 order by random() limit 1;
        if v_res_name is not null then
          v_res_have  := coalesce((tgt.resources->>v_res_name)::numeric, 0);
          v_res_steal := greatest(1, round(v_res_have * least(0.25, 0.06 * m.agents)));
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'), array[v_res_name],
              to_jsonb(greatest(0, coalesce((resources->>v_res_name)::numeric,0) - v_res_steal)))
            where faction_id=m.target_fid;
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'), array[v_res_name],
              to_jsonb(coalesce((resources->>v_res_name)::numeric,0) + v_res_steal))
            where faction_id=m.actor_fid;
          res := jsonb_build_object('resource', v_res_name, 'amount', v_res_steal);
        else
          ok := false; res := jsonb_build_object('note','no resources to steal');
        end if;

      -- ── саботаж одного здания ──
      elsif m.op='sabotage' then
        if m.target_colony is not null then
          select id,btype into bid,bt from public.colony_buildings
            where colony_id=m.target_colony and faction_id=m.target_fid order by random() limit 1;
        end if;
        if bid is null then
          select id,btype into bid,bt from public.colony_buildings where faction_id=m.target_fid order by random() limit 1;
        end if;
        select planet_name into v_colname from public.colonies where id = coalesce(m.target_colony, (select colony_id from public.colony_buildings where id=bid));
        if bid is not null then delete from public.colony_buildings where id=bid;
          res := jsonb_build_object('building',bt,'colony',v_colname);
        else res := jsonb_build_object('building',null); end if;

      -- ── массовый снос зданий ──
      elsif m.op='mass_demolish' then
        v_n_destroy := least(m.agents, 5);
        res := jsonb_build_object('buildings', '[]'::jsonb, 'count', 0);
        for v_i in 1..v_n_destroy loop
          bid := null; bt := null;
          if m.target_colony is not null then
            select id,btype into bid,bt from public.colony_buildings
              where colony_id=m.target_colony and faction_id=m.target_fid order by random() limit 1;
          end if;
          if bid is null then
            select id,btype into bid,bt from public.colony_buildings
              where faction_id=m.target_fid order by random() limit 1;
          end if;
          if bid is not null then
            delete from public.colony_buildings where id=bid;
            res := jsonb_set(
              jsonb_set(res, '{count}', to_jsonb((res->>'count')::int + 1)),
              '{buildings}', (res->'buildings') || to_jsonb(bt));
          end if;
        end loop;
        if (res->>'count')::int = 0 then ok := false; end if;

      -- ── кража технологий ──
      elsif m.op='steal_tech' then
        select research into techs from public.faction_economy where faction_id=m.target_fid;
        node := (select value::text from jsonb_array_elements_text(coalesce(techs,'[]'::jsonb)) value
                 where value::text not in (select jsonb_array_elements_text(coalesce(research,'[]'::jsonb)) from public.faction_economy where faction_id=m.actor_fid)
                 order by random() limit 1);
        if node is not null then
          update public.faction_economy set research = coalesce(research,'[]'::jsonb) || to_jsonb(node) where faction_id=m.actor_fid;
          res := jsonb_build_object('tech',node,'tech_name',node);
        else ok := false; res := jsonb_build_object('note','no tech to steal'); end if;

      -- ── дестабилизация ──
      elsif m.op='destabilize' then
        update public.faction_economy set debuff_pct=0.25, debuff_until=now()+interval '3 days' where faction_id=m.target_fid;
        res := jsonb_build_object('debuff_pct',0.25,'turns',3);

      -- ── ликвидация агента ──
      elsif m.op='kill_agent' then
        select id, first_name || ' ' || last_name into v_kill_id, v_kill_name
          from public.spy_agents where faction_id=m.target_fid and ready_at<=now()
          order by random() limit 1;
        if v_kill_id is not null then
          delete from public.spy_agents where id=v_kill_id;
          res := jsonb_build_object('agent_name', v_kill_name);
        else
          ok := false; res := jsonb_build_object('note','no available agents to eliminate');
        end if;

      -- ── насаждение веры ──
      elsif m.op='faith_impose' then
        select fm.faith_id into v_faith from public.faith_membership fm where fm.faction_id=m.actor_fid;
        if v_faith is not null and not exists(select 1 from public.faith_membership where faction_id=m.target_fid) then
          insert into public.faith_membership(faction_id, faith_id, role, owner_id)
            values(m.target_fid, v_faith, 'recognized', tgt.owner_id);
          select name into v_faith_name from public.faiths where id=v_faith;
          res := jsonb_build_object('faith', v_faith_name);
        else
          ok := false; res := jsonb_build_object('note','target already faithful or actor faithless');
        end if;
      end if;
    end if;

    if caught and jsonb_array_length(coalesce(m.agent_ids,'[]'::jsonb)) > 0 then
      delete from public.spy_agents where id = (m.agent_ids->>0)::uuid and faction_id=m.actor_fid;
      res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid));
    end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;
    perform public._post_covert_rumor(m.op, m.target_fid);
  end loop;
end$$;
revoke all on function public._spy_resolve(text) from public;

-- ── 4. spy_incoming: жертва видит новые виды операций ────────
create or replace function public.spy_incoming()
returns table(
  id uuid, op text, outcome text, detected boolean,
  actor_name text, result jsonb, evidence int, hint text,
  created_at timestamptz, ready_at timestamptz)
language sql security definer set search_path = public as $$
  with me as (
    select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
  )
  select
    m.id, m.op, m.outcome, m.detected,
    case when m.detected then public._fac_name(m.actor_fid) else null end,
    case when m.detected then m.result else (coalesce(m.result,'{}'::jsonb) - 'actor_name') end,
    coalesce(m.evidence,0),
    case when m.detected then null
         when coalesce(m.evidence,0) >= 67 then 'Фракция из ' || length(public._fac_name(m.actor_fid)) || ' симв., на «' || left(public._fac_name(m.actor_fid),1) || '…»'
         when coalesce(m.evidence,0) >= 34 then 'След ведёт к фракции на «' || left(public._fac_name(m.actor_fid),1) || '…»'
         else null end,
    m.created_at, m.ready_at
  from public.spy_missions m, me
  where m.target_fid = me.faction_id
    and m.status = 'done'
    and (m.detected = true
         or (m.outcome = 'success'
             and m.op in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose')))
  order by m.created_at desc
  limit 30;
$$;
revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- ── 5. _post_covert_rumor: слухи о новых операциях ───────────
drop function if exists public._post_covert_rumor(text, text);
create or replace function public._post_covert_rumor(p_op text, p_target_fid text default null)
returns void language plpgsql security definer set search_path=public as $$
declare titles text[]; bodies text[]; t text; b text; v_target text; v_place text;
begin
  if p_op not in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent') then return; end if;
  v_target := coalesce(nullif(public._fac_name(p_target_fid),''), 'одной из фракций');
  select 'системы ' || name into v_place from public.map_systems where faction = p_target_fid order by random() limit 1;
  v_place := coalesce(v_place, 'одного из секторов');
  case p_op
    when 'steal_gc' then
      titles := array['Ограбление казны в районе '||v_place, 'Дерзкая кража у фракции '||v_target, 'Пропали средства из конвоя'];
      bodies := array[
        format('Очевидцы в районе %s сообщают: ночью неизвестные вскрыли казначейский конвой %s и растворились в темноте. Официальные лица хранят молчание.', v_place, v_target),
        format('По слухам, со счетов %s исчезла крупная сумма. Свидетели в районе %s говорят о людях без опознавательных знаков.', v_target, v_place),
        format('Поговаривают, что казна %s заметно похудела за одну ночь в районе %s. Подробностей нет — только шёпот в портовых барах.', v_target, v_place)];
    when 'steal_res' then
      titles := array['Пропал груз у '||v_target, 'Обчистили склады в районе '||v_place, 'Кто-то вынес сырьё'];
      bodies := array[
        format('Поговаривают, что склады %s в районе %s оказались подозрительно пусты. Охрана клянётся — ничего не видели.', v_target, v_place),
        format('По неподтверждённым данным, неизвестные вынесли партию сырья из запасников %s. Концов найти не удалось.', v_target),
        format('Свидетели рассказывают о ночном фургоне без маркировки, покинувшем территорию %s в районе %s с явно тяжёлым грузом.', v_target, v_place)];
    when 'sabotage' then
      titles := array['Взрыв на объекте '||v_target, 'Диверсия в районе '||v_place, 'Ночью что-то рвануло'];
      bodies := array[
        format('Свидетели в районе %s сообщают о вспышке и густом дыме над одним из объектов %s. Власти говорят об «аварии», но очевидцы уверены — это диверсия.', v_place, v_target),
        format('По неподтверждённым данным, на заводе %s вышло из строя оборудование при крайне странных обстоятельствах. Кто-то явно постарался.', v_target),
        format('Местные в районе %s шепчутся: ночью громыхнуло так, что дрожали стёкла. У %s официально «ничего не происходило».', v_place, v_target)];
    when 'mass_demolish' then
      titles := array['Серия взрывов у '||v_target, 'Массовая диверсия в районе '||v_place, 'Целая инфраструктура разрушена'];
      bodies := array[
        format('Источники сообщают о серии скоординированных взрывов на объектах %s в районе %s. Масштаб разрушений явно указывает на профессионалов.', v_target, v_place),
        format('Поговаривают, что неизвестные диверсанты одновременно атаковали несколько точек %s. Урон, по слухам, колоссальный.', v_target),
        format('По неофициальным данным, в районе %s кто-то методично уничтожал постройки %s несколько часов подряд. Никто ничего не видел.', v_place, v_target)];
    when 'destabilize' then
      titles := array['Волнения у фракции '||v_target, 'Кто-то раскачивает '||v_place, 'Саботаж поставок'];
      bodies := array[
        format('Источники докладывают о перебоях со снабжением и нарастающем недовольстве в районе %s, на территории %s. Поговаривают о чужой руке.', v_place, v_target),
        format('Очевидцы рассказывают о странных сбоях и хаосе в делах %s. Совпадение? Вряд ли.', v_target),
        format('По слухам, кто-то методично расшатывает порядок у %s в районе %s. Доказательств, как обычно, нет.', v_target, v_place)];
    when 'steal_tech' then
      titles := array['Утечка разработок у '||v_target, 'Похищены чертежи в районе '||v_place, 'Шпионский след в НИИ'];
      bodies := array[
        format('Ходят слухи об утечке закрытых технологий из института %s в районе %s. Очевидцы видели спешно покидавший комплекс корабль без маркировки.', v_target, v_place),
        format('По неподтверждённым данным, секретные наработки %s внезапно «всплыли» у конкурентов. Совпадения исключены.', v_target),
        format('Поговаривают, что из-под носа охраны %s в районе %s вынесли нечто очень ценное. Кто именно — молчат все.', v_target, v_place)];
    when 'kill_agent' then
      titles := array['Загадочная гибель сотрудника '||v_target, 'Тёмное дело в районе '||v_place, 'Кто-то зачищает следы'];
      bodies := array[
        format('По неподтверждённым данным, один из офицеров спецслужб %s погиб при странных обстоятельствах в районе %s. Официальная версия — несчастный случай.', v_target, v_place),
        format('Источники шепчутся: у %s стало на одного разведчика меньше. Подробности засекречены, улик нет.', v_target),
        format('Поговаривают, что в районе %s нашли тело сотрудника %s без документов. Связи с иностранными агентами официально не признаётся.', v_place, v_target)];
    else return;
  end case;
  t := titles[1 + floor(random()*array_length(titles,1))::int];
  b := bodies[1 + floor(random()*array_length(bodies,1))::int];
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values (null, '⚠ СЕКТОРНЫЕ СЛУХИ', 'rgba(150,160,180,0.55)', null, null,
      t, null, b, 'approved', now(), now(), now());
  delete from public.faction_news
    where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
      and id not in (select id from public.faction_news
        where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
        order by created_at desc limit 15);
end$$;
revoke all on function public._post_covert_rumor(text, text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- steal_res:     разведать (basic), spy_launch('<tgt>','steal_res','["<id>"]') → крадёт сырьё
-- mass_demolish: разведать (deep),  spy_launch('<tgt>','mass_demolish','["<id1>","<id2>"]') → сносит 2 здания
-- kill_agent:    разведать (basic), spy_launch('<tgt>','kill_agent','["<id>"]') → убивает агента
