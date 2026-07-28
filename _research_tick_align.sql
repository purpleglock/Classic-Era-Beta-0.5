-- ═══════════════════════════════════════════════════════════════════════
-- Исследования: срок слота привязан к суточному тику, а не к «+24 ч»
-- 2026-07-28. Жалоба (повторная): «поставил 4 техи вчера — сегодня не изучились».
--
-- Причина: слот помечался r = старт + 24 ч РЕАЛЬНОГО времени, а закрывается
-- только на суточном тике (pg_cron economy_tick_all, 00:05 UTC). Тех,
-- поставленный днём, к ближайшей ночи ещё не «созревал» и уезжал на ВТОРУЮ
-- ночь. Допуск 6 ч в _research_step покрывал только старт до 06:05 —
-- то есть 18 часов суток из 24 давали задержку почти в двое суток.
--
-- Фикс: r = следующий суточный тик после старта (не ближе 2 ч).
-- Выдержка из _research_queue.sql (там же правка запечена).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public._research_ready_at()
returns timestamptz language sql stable set search_path=public as $$
  select case
    when t < now() + interval '2 hours' then t + interval '1 day'
    else t
  end
  from (select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
               + interval '1 day' + interval '5 minutes' as t) q;
$$;
revoke all on function public._research_ready_at() from public;
grant execute on function public._research_ready_at() to authenticated;

create or replace function public._research_step(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy;
  slot jsonb; kept jsonb := '[]'::jsonb; done_ids text[] := '{}';
  smax int; nid text; tn public.tech_nodes; cost numeric; mres numeric;
  in_slot boolean; has_missing boolean;
  new_queue jsonb := '[]'::jsonb;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return; end if;

  -- 1) завершить готовые слоты → research[]
  -- Допуск 6 ч оставлен как страховка от дрейфа времени тика и для старых
  -- слотов с r = старт+24 ч, записанных до этой правки.
  for slot in select value from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) loop
    if (slot->>'r') is not null and (slot->>'r')::timestamptz <= now() + interval '6 hours' then
      done_ids := array_append(done_ids, slot->>'n');
    else
      kept := kept || slot;
    end if;
  end loop;
  if array_length(done_ids,1) is not null then
    eco.research := coalesce(eco.research,'[]'::jsonb) || to_jsonb(done_ids);
    eco.research_slots := kept;
  end if;

  -- 2) добрать из очереди в свободные слоты (пропуская не готовые, без затора по голове)
  smax := public._research_slots(p_fid);
  mres := (public._faction_mods(p_fid)->>'research')::numeric;
  for nid in select value from jsonb_array_elements_text(coalesce(eco.research_queue,'[]'::jsonb)) loop
    if jsonb_array_length(eco.research_slots) >= smax then
      new_queue := new_queue || to_jsonb(nid);
      continue;
    end if;

    select * into tn from public.tech_nodes where node_id = nid;
    select exists(select 1 from jsonb_array_elements(eco.research_slots) sl
                  where sl.value->>'n' = nid) into in_slot;
    if tn.node_id is null or (coalesce(eco.research,'[]'::jsonb) ? nid) or in_slot then
      continue;
    end if;

    select exists(
      select 1 from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) pr
      where not (coalesce(eco.research,'[]'::jsonb) ? pr.value)
    ) into has_missing;

    cost := greatest(1, round(tn.base_cost * mres));

    if has_missing or coalesce(eco.science,0) < cost then
      new_queue := new_queue || to_jsonb(nid);
      continue;
    end if;

    eco.research_slots := eco.research_slots
      || jsonb_build_object('n', nid, 'r', public._research_ready_at());
    eco.science := coalesce(eco.science,0) - cost;
  end loop;

  eco.research_queue := new_queue;
  update public.faction_economy
    set research      = eco.research,
        research_slots = eco.research_slots,
        research_queue = eco.research_queue,
        science       = eco.science
    where faction_id = p_fid;
end$$;
revoke all on function public._research_step(text) from public;
grant execute on function public._research_step(text) to authenticated;

create or replace function public.economy_research(p_node text, p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; tn public.tech_nodes;
  smax int; cost numeric; missing text; in_slot boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;

  select * into tn from public.tech_nodes where node_id = p_node;
  if not found then raise exception 'unknown tech node'; end if;

  smax := public._research_slots(app.faction_id);
  if jsonb_array_length(coalesce(eco.research_slots,'[]'::jsonb)) >= smax then raise exception 'research in progress'; end if;
  select exists(select 1 from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) sl
                where sl.value->>'n' = p_node) into in_slot;
  if in_slot then raise exception 'already in progress'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;

  select string_agg(pr.value, ', ') into missing
    from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) pr
    where not (coalesce(eco.research,'[]'::jsonb) ? pr.value);
  if missing is not null then raise exception 'missing prerequisites: %', missing; end if;

  cost := greatest(1, round(tn.base_cost * (public._faction_mods(app.faction_id)->>'research')::numeric));
  if coalesce(eco.science,0) < cost then raise exception 'not enough science'; end if;

  update public.faction_economy
    set science = science - cost,
        research_slots = coalesce(research_slots,'[]'::jsonb)
          || jsonb_build_object('n', p_node, 'r', public._research_ready_at())
    where faction_id = app.faction_id;

  -- Немедленно заполнить оставшиеся свободные слоты из очереди (без ожидания тика).
  perform public._research_step(app.faction_id);

  return jsonb_build_object('ok', true, 'cost', cost, 'ready_at', public._research_ready_at());
end$$;
revoke all on function public.economy_research(text,numeric) from public;
grant execute on function public.economy_research(text,numeric) to authenticated;

-- ── Разморозка: пересчитать срок уже висящих слотов на ближайший тик ──────
update public.faction_economy e
   set research_slots = (
     select coalesce(jsonb_agg(jsonb_set(sl.value, '{r}', to_jsonb(public._research_ready_at()))), '[]'::jsonb)
     from jsonb_array_elements(e.research_slots) sl
   )
 where jsonb_array_length(coalesce(e.research_slots,'[]'::jsonb)) > 0;
