-- ════════════════════════════════════════════════════════════
-- ХРОНИКА · МИР ИЗ РЕЕСТРА  (этап 12, пункт 1; поверх _precursor_saga_worlds.sql)
--
-- Было: хроника — рукопись, и мир в ключе назывался словом ('kailat').
-- Стало: мир хроники — НАЙДЕННОЕ ТЕЛО, и ключ у него `civ:<system_id>:<pid>`.
-- Отсюда три правки:
--
--   1. ключ длиннее 32 символов (system_id — строка карты, а не число);
--   2. умолчания 'kailat' в колонке world больше нет: новая строка обязана
--      назвать свой мир, иначе следы двух хроник слипнутся в одну;
--   3. precursor_saga_get отдаёт РАСУ И ДОКТРИНУ вашей державы — без них
--      клиент собрал бы всем игрокам одну и ту же бухту, а она у акватика и
--      у литоида разная, и запись о вас внизу тоже разная.
--
-- Старые следы (kailat, kharn) остаются как есть и читаются по-прежнему:
-- их сюжеты уезжают в пласты отдельным шагом, и терять чужое прохождение
-- раньше этого нельзя.
--
-- Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

-- ── ключ мира: длиннее и без умолчания ─────────────────────
alter table public.precursor_saga        alter column world drop default;
alter table public.precursor_saga_wait   alter column world drop default;
alter table public.precursor_saga_reward alter column world drop default;

comment on column public.precursor_saga.world is
  'Какая хроника. Найденный мир: civ:<system_id>:<pid>. Старое, рукописное: kailat, kharn.';

create index if not exists idx_pc_saga_world on public.precursor_saga(world);

-- ── чтение: следы разом + кто смотрит ──────────────────────
drop function if exists public.precursor_saga_get();
create or replace function public.precursor_saga_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; v_rows jsonb; v_me jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'world', r.world, 'node', r.node, 'flags', r.flags, 'seen', r.seen,
           'done', r.done, 'ending', r.ending,
           'started_at', r.started_at, 'updated_at', r.updated_at,
           -- срок возврата считает сервер: часы игрока свои у каждого
           'ready_at', case when w.hours is not null
             then r.updated_at + (w.hours || ' hours')::interval end)), '[]'::jsonb)
    into v_rows
    from public.precursor_saga r
    left join lateral (
      select public._pc_saga_wait(r.world, r.node) as hours) w on true
   where r.faction_id = fid;

  -- Кто смотрит. Раса решает, какими словами вас запишут внизу; доктрина —
  -- какие ходы вам вообще доступны. Форма правления идёт следом: она нужна
  -- пластам там, где решает не держава, а тот, кого она послала.
  select jsonb_build_object(
           'fid', fid, 'name', a.name, 'race', a.race,
           'ideology', a.ideology, 'gov', a.gov)
    into v_me
    from public.faction_applications a
   where a.faction_id = fid and a.status = 'approved'
   limit 1;

  return jsonb_build_object('ok', true, 'rows', v_rows,
                            'me', coalesce(v_me, jsonb_build_object('fid', fid)),
                            'now', now());
end$$;

-- ── шаг: ключ мира стал длиннее ────────────────────────────
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  -- 96 — с запасом на 'civ:' + id системы + номер тела. Ограничение оставлено:
  -- ключ приходит от клиента, и пускать в колонку что угодно нельзя.
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

  v_flags := coalesce(r.flags, '{}'::jsonb) || coalesce(p_flags, '{}'::jsonb);
  v_seen  := case when coalesce(r.seen, '[]'::jsonb) @> to_jsonb(array[r.node])
                  then r.seen else coalesce(r.seen, '[]'::jsonb) || to_jsonb(array[r.node]) end;

  update public.precursor_saga
     set node = p_node, flags = v_flags, seen = v_seen,
         done = (p_ending is not null), ending = p_ending, updated_at = now()
   where faction_id = fid and world = p_world;

  if p_ending is not null then
    v_pay := public._pc_saga_pay(fid, p_world, p_ending);
  end if;

  return jsonb_build_object('ok', true, 'world', p_world, 'node', p_node,
                            'flags', v_flags, 'done', p_ending is not null,
                            'ending', p_ending, 'pay', v_pay);
end$$;

-- ── выдержки между главами: общие для всех найденных миров ──
-- Сроки живут в таблице по паре (world, node), а найденных миров столько,
-- сколько их на карте. Строку на каждый мир класть нечем и незачем: узлы у
-- них одни и те же (пласты), поэтому мир '*' читается как «любой».
alter table public.precursor_saga_wait
  add column if not exists note text;

insert into public.precursor_saga_wait (world, node, hours, note) values
  ('*', 'p2', 6,  'Пролог: мир стоит на пустом месте — глава дожидается срока'),
  ('*', 'd0', 12, 'Пустое место: летописец приходит сам, но не в тот же день'),
  ('*', 'r0', 12, 'Кому говорить: смута зреет не за час'),
  ('*', 'f0', 24, 'Чем платят: виру собирают долго'),
  ('*', 'f_сами', 24, 'Собирают своими руками — и собирают не всю')
on conflict (world, node) do update set hours = excluded.hours, note = excluded.note;

-- Поиск срока: сперва свой мира, потом общий '*'. Иначе рукописные хроники
-- потеряли бы собственные сроки, а найденные — не получили никаких.
create or replace function public._pc_saga_wait(p_world text, p_node text)
returns numeric language sql stable set search_path to 'public' as $$
  select hours from public.precursor_saga_wait
   where node = p_node and world in (p_world, '*')
   order by (world = p_world) desc limit 1;
$$;

grant execute on function public.precursor_saga_get() to authenticated;
grant execute on function public.precursor_saga_step(text, text, jsonb, text) to authenticated;
