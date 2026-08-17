-- ════════════════════════════════════════════════════════════
-- ХРОНИКА · ЧАША  (этап 2.3; накатывать ПОСЛЕ _precursor_saga_cost.sql)
--
-- Было: исход считался по флагам ПОСЛЕДНИХ узлов — `летопись` и `ваше`. Всё,
-- что игрок делал первые четыре главы, в конец не доезжало: пять глав держать
-- уговор и один раз качнуть ихор — то же самое, что качать всю дорогу.
--
-- Стало: у каждого варианта есть вес (полка «цена», поле `вес`), и веса
-- СКЛАДЫВАЮТСЯ в чашу мира. Чаша лежит в следе хроники, копит её сервер —
-- клиент её не считает, иначе исход можно было бы назначить себе руками.
--
-- Чаша не шкала репутации и наружу числом не показывается: игрок видит её
-- метками узлов внизу кадра, и только после своего решения.
--
-- Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

alter table public.precursor_saga
  add column if not exists scale numeric not null default 0;

comment on column public.precursor_saga.scale is
  'Чаша мира: сумма весов решений. + к державе-соседу, − к кризису. Считает только сервер.';

-- ── чтение: чаша, склад и занятые хроникой слоты ───────────
-- Склад отдаётся вместе со следом, потому что дверь и сцена обязаны ЗНАТЬ
-- ЗАРАНЕЕ: вариант, на который нечем платить, не рисуется вовсе (конструктор,
-- полка «цена»). Спрашивать склад отдельным запросом на каждую сцену значило
-- бы платить запросом за кадр.
drop function if exists public.precursor_saga_get();
create or replace function public.precursor_saga_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; v_rows jsonb; v_me jsonb; v_bag jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'world', r.world, 'node', r.node, 'flags', r.flags, 'seen', r.seen,
           'done', r.done, 'ending', r.ending, 'scale', r.scale,
           'started_at', r.started_at, 'updated_at', r.updated_at,
           'ready_at', case when w.hours is not null
             then r.updated_at + (w.hours || ' hours')::interval end)), '[]'::jsonb)
    into v_rows
    from public.precursor_saga r
    left join lateral (
      select public._pc_saga_wait(r.world, r.node) as hours) w on true
   where r.faction_id = fid;

  select jsonb_build_object(
           'fid', fid, 'name', a.name, 'race', a.race,
           'ideology', a.ideology, 'gov', a.gov)
    into v_me
    from public.faction_applications a
   where a.faction_id = fid and a.status = 'approved'
   limit 1;

  select coalesce(resources, '{}'::jsonb) into v_bag
    from public.faction_economy where faction_id = fid;

  return jsonb_build_object('ok', true, 'rows', v_rows,
                            'me', coalesce(v_me, jsonb_build_object('fid', fid)),
                            'склад', coalesce(v_bag, '{}'::jsonb),
                            'слоты', public._pc_saga_holds(fid),
                            'now', now());
end$$;

-- ── шаг: вес решения падает в чашу ─────────────────────────
-- Вес приходит от клиента вместе с переходом и зажимается рамкой: одно
-- решение не может стоить больше трёх делений в любую сторону, сколько бы
-- ни было написано в файле мира.
drop function if exists public.precursor_saga_step(text, text, jsonb, text, jsonb);
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null,
  p_cost jsonb default null, p_weight numeric default 0)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb; v_cost jsonb; v_w numeric; v_scale numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  if p_world is null or length(p_world) = 0 or length(p_world) > 96 then
    return jsonb_build_object('ok', false, 'err', 'хроника не названа');
  end if;
  if p_node is null or length(p_node) = 0 or length(p_node) > 64 then
    return jsonb_build_object('ok', false, 'err', 'узел не назван');
  end if;

  select * into r from public.precursor_saga where faction_id = fid and world = p_world;
  if not found then
    insert into public.precursor_saga (faction_id, world) values (fid, p_world)
      on conflict (faction_id, world) do nothing;
    select * into r from public.precursor_saga where faction_id = fid and world = p_world;
  end if;

  if r.done then
    return jsonb_build_object('ok', false, 'err', 'хроника дописана');
  end if;

  v_wait := public._pc_saga_wait(p_world, r.node);
  if v_wait is not null and now() < r.updated_at + (v_wait || ' hours')::interval then
    return jsonb_build_object(
      'ok', false, 'err', 'срок не вышел', 'wait', true,
      'ready_at', r.updated_at + (v_wait || ' hours')::interval);
  end if;

  v_cost := public._pc_saga_cost(fid, p_world, r.node, p_cost, false);
  if (v_cost->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'err', v_cost->>'err', 'cost', v_cost);
  end if;

  -- Одно решение — одна ступень: узел, который уже пройден, второй раз в чашу
  -- не падает. Иначе «Назад» в браузере стоил бы миру целого исхода.
  v_w := greatest(-3, least(3, coalesce(p_weight, 0)));
  if coalesce(r.seen, '[]'::jsonb) @> to_jsonb(array[r.node]) then v_w := 0; end if;
  v_scale := coalesce(r.scale, 0) + v_w;

  v_flags := coalesce(r.flags, '{}'::jsonb) || coalesce(p_flags, '{}'::jsonb);
  v_seen  := case when coalesce(r.seen, '[]'::jsonb) @> to_jsonb(array[r.node])
                  then r.seen else coalesce(r.seen, '[]'::jsonb) || to_jsonb(array[r.node]) end;

  update public.precursor_saga
     set node = p_node, flags = v_flags, seen = v_seen, scale = v_scale,
         done = (p_ending is not null), ending = p_ending, updated_at = now()
   where faction_id = fid and world = p_world;

  if p_ending is not null then
    v_pay := public._pc_saga_pay(fid, p_world, p_ending);
  end if;

  return jsonb_build_object('ok', true, 'world', p_world, 'node', p_node,
                            'flags', v_flags, 'done', p_ending is not null,
                            'ending', p_ending, 'pay', v_pay, 'cost', v_cost,
                            'scale', v_scale);
end$$;

grant execute on function public.precursor_saga_get() to authenticated;
grant execute on function public.precursor_saga_step(text, text, jsonb, text, jsonb, numeric)
  to authenticated;
