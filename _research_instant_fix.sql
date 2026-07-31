-- ═══════════════════════════════════════════════════════════════════════
-- Исследования изучались МГНОВЕННО (вечером по UTC)
-- 2026-07-31.
--
-- Причина: _research_ready_at() ставит слоту r = ближайший суточный тик
-- (00:05 UTC), а _research_step закрывал слот при r <= now() + 6 часов
-- (допуск времён правки 28.07, для старых слотов с r = старт+24 ч).
-- Значит всё, что запускалось после 18:05 UTC, «созревало» прямо в том же
-- вызове economy_research → тех изучался мгновенно, а следом так же мгновенно
-- вытягивалась вся очередь. Фракция, чей игрок активен вечером, получала
-- исследования бесплатно по времени.
--
-- Фикс: допуск 6 ч → 10 минут (только страховка от дрейфа времени тика).
-- Старых слотов с r = старт+24 ч в базе уже нет (проверено 31.07).
-- ═══════════════════════════════════════════════════════════════════════

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
  -- Допуск 10 минут: только на дрейф времени суточного тика (00:05 UTC).
  for slot in select value from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) loop
    if (slot->>'r') is not null and (slot->>'r')::timestamptz <= now() + interval '10 minutes' then
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
