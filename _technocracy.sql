-- ════════════════════════════════════════════════════════════
-- ТЕХНОКРАТИЯ — срез 1: «доп. исследования»
-- Технократы ведут больше исследований ПАРАЛЛЕЛЬНО:
--   • форма правления «Технократия»            → +1 слот исследований
--   • идеология «Технократия (Культ науки)»    → +1 слот исследований
-- Оба выбора стекаются (полноценная научная держава) и складываются с
-- бонусом роботов (+1) и политиками ветки «Разум» (+1/+2).
-- Зеркало клиента: ecResearchSlots() / ecTechnoSlots() в economy.js.
-- Применять в Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════

create or replace function public._research_slots(p_fid text)
returns int language plpgsql stable security definer set search_path=public as $$
declare n int := 1; rs jsonb; a public.faction_applications;
begin
  if public._faction_is_robot(p_fid) then n := n + 1; end if;
  -- Технократы: бонусные слоты по доктрине (зеркало EC_DOCTRINE_SLOTS в economy.js)
  select * into a from public.faction_applications
    where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;
  if found then
    if a.gov = 'Технократия'                    then n := n + 1; end if;
    if a.ideology = 'Технократия (Культ науки)' then n := n + 1; end if;
  end if;
  select research into rs from public.faction_economy where faction_id = p_fid;
  rs := coalesce(rs, '[]'::jsonb);
  if rs ? 'pol.light_knowledge' then n := n + 1; end if;
  if rs ? 'pol.mind_supremacy'  then n := n + 2; end if;
  return n;
end$$;
revoke all on function public._research_slots(text) from public;
grant execute on function public._research_slots(text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- ДРЕЙН ОЧЕРЕДИ: немедленно заполнить свободные слоты из очереди.
-- Вызывается клиентом при открытии вкладки «Технологии» и после
-- любого действия с очередью — так свободный слот забирается сразу,
-- а не ждёт ночного тика.
-- По сути — публичная обёртка над _research_step (без завершения слотов,
-- только добор). Используем _research_step целиком: она идемпотентна
-- (завершение слотов в ней безвредно — уже-завершённые слоты она учтёт).
-- ════════════════════════════════════════════════════════════

create or replace function public.research_drain_queue()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  app public.faction_applications;
  fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  fid := app.faction_id;
  perform public._research_step(fid);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.research_drain_queue() from public;
grant execute on function public.research_drain_queue() to authenticated;

-- ── Проверки ─────────────────────────────────────────────────
-- select public._research_slots('<faction_id>');
-- select public.research_drain_queue();
