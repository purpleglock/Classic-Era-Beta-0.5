-- ════════════════════════════════════════════════════════════
-- РАЗВЕДКА: количество — это риск, а не сила
-- ════════════════════════════════════════════════════════════
-- Было: succ = 55 + a*8 + Σ(перки/уровни/артефакты всех) − hard,
--       det  = 6 + prot*0.7 + a*2 + ...
-- Успех рос от головы на +8, палево — на +2, а сложность от числа
-- агентов не зависела вовсе. Максимум ростера был ВСЕГДА правильным
-- ответом, и разведка сводилась к одному числу — _spy_agent_cap.
--
-- Стало:
--   1) вклад группы убывает по рангу (1.0 / 0.30 / 0.15 / 0.07 / 0.03…):
--      операцию тянет ВЕДУЩИЙ оперативник, остальные лишь страхуют.
--      Пятеро середняков больше не заменяют одного профи;
--   2) палево растёт квадратично: 2*(a−1) + 1.5*(a−1)².
--      Двойка почти бесплатна, шестёрка — самоубийство.
-- Изъяны (flaw_diff) по-прежнему складываются ЦЕЛИКОМ: каждый лишний
-- человек — это лишняя обуза. Скорость (turns ~ 1/sqrt(a)) оставлена
-- как есть: это честный и единственный выигрыш массы — быстро и громко.

-- Вес участника по рангу (1 = ведущий).
create or replace function public._spy_squad_weight(p_rank int)
returns numeric language sql immutable as $$
  select case p_rank
    when 1 then 1.00 when 2 then 0.30 when 3 then 0.15 when 4 then 0.07
    else 0.03 end::numeric
$$;
revoke all on function public._spy_squad_weight(int) from public;
grant execute on function public._spy_squad_weight(int) to authenticated;

-- Суммарная эффективность группы из n человек: 1 → 1.00, 2 → 1.30,
-- 3 → 1.45, 4 → 1.52, 5 → 1.55, 6 → 1.58 …
create or replace function public._spy_squad_eff(p_n int)
returns numeric language sql immutable as $$
  select coalesce(sum(public._spy_squad_weight(i)), 0)
    from generate_series(1, greatest(coalesce(p_n, 0), 0)) i
$$;
revoke all on function public._spy_squad_eff(int) from public;
grant execute on function public._spy_squad_eff(int) to authenticated;

-- Штраф палева за размер группы (сверх одиночки).
create or replace function public._spy_squad_noise(p_n int)
returns numeric language sql immutable as $$
  select (2 * greatest(coalesce(p_n,1) - 1, 0)
        + 1.5 * power(greatest(coalesce(p_n,1) - 1, 0), 2))::numeric
$$;
revoke all on function public._spy_squad_noise(int) from public;
grant execute on function public._spy_squad_noise(int) to authenticated;

-- ── spy_launch: пересобран надмножеством _intel_protection.sql ──
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; need text; rec text;
  a int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; succ_b numeric; det_b numeric; v_colony uuid;
  trace text; race_mod numeric; flaw_diff numeric; flaw_det numeric;
  art_pierce numeric; v_eff numeric; v_noise numeric;
  v_sys text; prot int; wt numeric; hard numeric;
  v_guar uuid; v_cut boolean; v_used jsonb := '[]'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;

  if p_op = 'faith_impose' then
    if not exists(select 1 from public.faith_membership where faction_id=app.faction_id) then
      raise exception 'you follow no faith to spread'; end if;
    if exists(select 1 from public.faith_sects where owner_fid=app.faction_id and host_fid=p_target_fid and status='active') then
      raise exception 'you already run a sect in that nation'; end if;
  end if;

  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

  -- доступные агенты: готовы, не пленники, не на задании, НЕ в охране систем
  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id and coalesce(ag.captive,false)=false
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text)
    and not exists(select 1 from public.faction_intel_guard g
                   where g.faction_id=app.faction_id and g.agent_id=ag.id);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent: свободных оперативников нет (проверьте охрану систем)'; end if;
  if p_op in ('steal_tech','mass_demolish') and a < 2 then
    raise exception 'this op needs a network: at least 2 agents'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  -- ── ВКЛАД ГРУППЫ ПО РАНГУ ──
  -- Личный вклад каждого (перки + уровень + его артефакты), затем сортировка
  -- по убыванию и вес по месту: тянет ведущий, прочие лишь страхуют.
  with pa as (
    select ag.id,
      public._spy_perk_succ(ag.perk,  p_op, ag.level)
    + public._spy_perk_succ(ag.perk2, p_op, ag.level)
    + (greatest(coalesce(ag.level,1),1)-1)*3
    + coalesce((select sum(public._spy_artifact_succ(art.kind, p_op))
                  from public.spy_artifacts art
                 where art.equipped_agent=ag.id and coalesce(art.spent,false)=false),0) as s,
      (case when ag.perk='ghost' or ag.perk2='ghost'
            then 10 + (greatest(coalesce(ag.level,1),1)-1)*2 else 0 end)
    + (greatest(coalesce(ag.level,1),1)-1)*2
    + coalesce((select sum(public._spy_artifact_det(art.kind))
                  from public.spy_artifacts art
                 where art.equipped_agent=ag.id and coalesce(art.spent,false)=false),0) as d
    from public.spy_agents ag where ag.id = any(v_ids)
  ), rs as (select s, row_number() over (order by s desc) rk from pa),
     rd as (select d, row_number() over (order by d desc) rk from pa)
  select coalesce((select sum(s * public._spy_squad_weight(rk::int)) from rs),0),
         coalesce((select sum(d * public._spy_squad_weight(rk::int)) from rd),0)
    into succ_b, det_b;
  succ_b := round(succ_b); det_b := round(det_b);

  -- изъяны оперативников — прямо в сложность, ЦЕЛИКОМ (лишний человек = лишняя обуза)
  select coalesce(sum(public._spy_flaw_diff(ag.flaw, p_op)),0),
         coalesce(sum(public._spy_flaw_det(ag.flaw)),0)
    into flaw_diff, flaw_det
    from public.spy_agents ag where ag.id = any(v_ids);

  -- пробитие защиты и сокращение хода — свойства снаряжения, не количества
  select coalesce(sum(k.pierce),0), bool_or(k.turn_cut)
    into art_pierce, v_cut
    from public.spy_artifacts art
    join public.spy_artifact_kinds k on k.key=art.kind
    where art.equipped_agent = any(v_ids) and coalesce(art.spent,false)=false;

  -- вживание по расе
  select race into trace from public.faction_applications
    where faction_id=p_target_fid and status='approved' order by updated_at desc limit 1;
  if trace is null then
    select race into trace from public.faction_applications
      where faction_id=p_target_fid order by updated_at desc limit 1;
  end if;
  select coalesce(avg(public._spy_race_penalty(ag.race, trace)),0) into race_mod
    from public.spy_agents ag where ag.id = any(v_ids);
  race_mod := round(race_mod * (case when meta ? 'recon' then 0.5 else 1 end));

  -- ЗАЩИЩЁННОСТЬ ЦЕЛИ = сложность операции
  v_sys := public._intel_op_sys(p_target_fid, v_colony);
  prot  := public.system_protection(p_target_fid, v_sys);
  wt    := public._spy_op_weight(p_op);
  hard  := round(greatest(0, prot - coalesce(art_pierce,0)) * wt) + race_mod + flaw_diff;

  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);

  v_eff   := public._spy_squad_eff(a);
  v_noise := public._spy_squad_noise(a);

  succ := greatest(5, least(95, round(55 + 8*v_eff + ibonus + spow + succ_b - hard)));
  det  := greatest(2, least(90, round(6 + prot*0.7 + v_noise + flaw_det
                                      + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));
  if coalesce(v_cut,false) then turns := greatest(1, turns - 1); end if;

  -- ГАРАНТИЯ: одноразовый предмет с guaranteed сгорает и делает операцию верной
  select art.id into v_guar
    from public.spy_artifacts art
    join public.spy_artifact_kinds k on k.key=art.kind
   where art.equipped_agent = any(v_ids) and coalesce(art.spent,false)=false and k.guaranteed
   limit 1;
  if v_guar is not null then
    succ := 100;
    delete from public.spy_artifacts where id=v_guar;
    v_used := v_used || to_jsonb(v_guar::text);
  end if;
  delete from public.spy_artifacts a using public.spy_artifact_kinds k
    where k.key=a.kind and k.one_shot and a.equipped_agent = any(v_ids) and a.id is distinct from v_guar;

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval,
      jsonb_build_object('protection', prot, 'weight', wt, 'race_mod', race_mod,
                         'flaw_diff', flaw_diff, 'hard', hard, 'guaranteed', v_guar is not null,
                         'squad_eff', v_eff, 'squad_noise', v_noise));
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a,
    'protection',prot,'weight',wt,'race_mod',race_mod,'flaw_diff',flaw_diff,'hard',hard,
    'squad_eff',v_eff,'squad_noise',v_noise,
    'pierce',coalesce(art_pierce,0),'guaranteed', v_guar is not null, 'system_id', v_sys);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;
