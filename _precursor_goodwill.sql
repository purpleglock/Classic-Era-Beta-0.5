-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ТРИ РЫЧАГА ДОБРОЙ ВОЛИ
--
-- Раньше всё, что игрок мог сделать с дозвёздным миром, было либо нейтральным
-- (изучать), либо тем, за что потом стыдно. Отношение к контакту при этом решало
-- судьбу протектората и проповеди — но поднять его было нечем.
--
--   gift    ДАР С НЕБА     — лекарства, зерно, металл: отношение и благополучие
--   envoy   ТИХАЯ МИССИЯ   — дешёвый долгий контакт без чудес, малый плюс
--   miracle ЗНАМЕНИЕ       — представление в небе: много отношения, но мир
--                            уходит в спиритуализм и Фонд это запомнит
--
-- У доброй воли СВОИ часы (last_gift_at), чтобы дар не блокировал наблюдение и
-- наоборот. Отдача падает с каждым разом: чем лучше к вам относятся, тем меньше
-- прибавка (масштаб 1 − att/100) и тем дороже следующий подарок.
--
-- ⚠ Обёртка precursor_act переименована в _precursor_act_v2 (как когда-то v1).
--   Перекатывать _precursor_growth.sql после этого файла НЕЛЬЗЯ: он вернёт
--   старую обёртку и три решения пропадут. Сначала он, потом этот.
-- ════════════════════════════════════════════════════════════

alter table public.primitive_civs
  add column if not exists last_gift_at timestamptz;

-- ── цена (зеркало клиента pcCost) ─────────────────────────
create or replace function public._pc_gift_cost(p_action text, p_tier int, p_gifts int)
returns numeric language sql immutable set search_path=public as $$
  select (case p_action
    when 'gift'    then 120000 + 40000 * p_tier
    when 'envoy'   then  60000 + 20000 * p_tier
    when 'miracle' then 200000 + 60000 * p_tier
    else 0 end * (1 + 0.35 * least(6, greatest(0, p_gifts))))::numeric;
$$;

-- ── сама обёртка ──────────────────────────────────────────
do $$
begin
  if to_regprocedure('public._precursor_act_v2(text,int,text)') is null then
    execute 'alter function public.precursor_act(text,int,text) rename to _precursor_act_v2';
    execute 'revoke all on function public._precursor_act_v2(text,int,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype; fid text; v_cost numeric; v_gc numeric; v_rep int;
  v_gifts int; v_att int; v_wb int; v_txt text; v_line text; v_ideo text;
begin
  if p_action not in ('gift', 'envoy', 'miracle') then
    return public._precursor_act_v2(p_system_id, p_pid, p_action);
  end if;

  fid := public._ec_my_fid();
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found then raise exception 'no civ'; end if;
  if c.status = 'dead' then raise exception 'civ is gone'; end if;
  if c.status = 'spacefaring' then raise exception 'civ is sovereign'; end if;
  if not exists (select 1 from public.colonies col
                  where col.system_id = c.system_id and col.faction_id = fid)
     and coalesce(c.patron_fid, '') <> fid then
    raise exception 'no presence in system';
  end if;
  if c.patron_fid is not null and c.patron_fid <> fid then
    raise exception 'civ belongs to another patron';
  end if;
  if c.last_gift_at is not null and now() - c.last_gift_at < interval '20 hours' then
    raise exception 'too soon';
  end if;

  v_gifts := coalesce((c.flags->>'gifts')::int, 0);
  v_cost  := public._pc_gift_cost(p_action, c.tier, v_gifts);
  select e.gc into v_gc from public.faction_economy e where e.faction_id = fid;
  if coalesce(v_gc, 0) < v_cost then raise exception 'not enough gc'; end if;
  update public.faction_economy set gc = gc - v_cost where faction_id = fid and gc >= v_cost;

  -- прибавка тем меньше, чем лучше к вам и так относятся
  v_att := greatest(2, round((case p_action when 'gift' then 14
                                            when 'envoy' then 7
                                            else 28 end) * (1 - greatest(0, c.attitude) / 100.0))::int);
  v_wb  := case p_action when 'gift' then 5 when 'miracle' then 2 else 0 end;

  if p_action = 'gift' then
    v_rep  := public._pc_rep(fid, -5);
    v_line := 'С неба спустили дар: зерно, лекарства и металл, каких здесь не куют. '
           || c.self_name || ' не знают, чем отплатят, но помнить будут долго.';
    v_txt  := 'Дар принят. ' || c.self_name || ' стали к вам теплее на ' || v_att || '.';
  elsif p_action = 'envoy' then
    v_rep  := public._pc_rep(fid, -2);
    v_line := 'Кто-то приходил и уходил, не показывая лица: чинил колодцы, оставлял карты, '
           || 'слушал их песни. У ' || c.self_name || ' появилась примета — гость с неба не всегда беда.';
    v_txt  := 'Тихая миссия отработала. Отношение +' || v_att || '.';
  else
    v_rep  := public._pc_rep(fid, -10);
    v_ideo := 'Спиритуализм';
    v_line := 'Небо над ними горело всю ночь и говорило голосом, который поняли все сразу. '
           || 'После этого у ' || c.self_name || ' не осталось сомнений, что за облаками кто-то есть.';
    v_txt  := 'Знамение показано. Отношение +' || v_att || ', но теперь они молятся вашему небу.';
  end if;

  update public.primitive_civs
     set attitude   = least(100, attitude + v_att),
         wellbeing  = least(100, wellbeing + v_wb),
         ideology   = coalesce(v_ideo, ideology),
         last_gift_at = now(),
         acts       = acts + 1,
         flags      = flags || jsonb_build_object('gifts', v_gifts + 1),
         patron_fid = case when p_action = 'miracle' then coalesce(patron_fid, fid) else patron_fid end,
         contacted_by = coalesce(contacted_by, fid),
         contacted_at = coalesce(contacted_at, now()),
         chronicle  = chronicle || jsonb_build_array(jsonb_build_object('ph', 'контакт', 'text', v_line))
   where system_id = c.system_id and pid = c.pid;

  insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
    values (c.system_id, c.pid, fid, p_action,
            jsonb_build_object('cost', v_cost, 'att', v_att, 'rep', v_rep));

  return jsonb_build_object('ok', true, 'txt', v_txt, 'cost', v_cost, 'rep', v_rep, 'att', v_att);
end$$;
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;
