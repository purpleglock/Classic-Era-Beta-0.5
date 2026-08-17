-- ════════════════════════════════════════════════════════════
-- ХРОНИКА · ЦЕНА РЕШЕНИЯ  (этап 2.1–2.2; поверх _precursor_saga_civs.sql)
--
-- Было: цена варианта лежала В ДАННЫХ (`цена` на полке конструктора), ценник
-- игрок читал до нажатия — и не платил ничего. Выбор без цены выбором не
-- является: все пять глав можно было пройти, ни разу ничего не отдав.
--
-- Стало: груз списывается СО СКЛАДА при переходе, а срок ЗАНИМАЕТ СЛОТ
-- ИССЛЕДОВАНИЯ на столько ходов, сколько сказано в ценнике. Ход — сутки, как
-- везде в игре. Не хватило груза — перехода не происходит вовсе: ни флага, ни
-- узла, ни списания. Отказ возвращается словами, а не молчанием.
--
-- ⚠ Валют ровно три (конструктор): груз со склада, время державы, чаша мира.
-- ГС, флот и агенты валютой не будут.
--
-- ⚠ ДОВЕРИЕ. Содержание хроники живёт в клиенте — сервер хранит след и не
-- спорит о тексте. Цену он поэтому тоже слышит от клиента, и соврать в свою
-- пользу тут можно только В ОДНУ СТОРОНУ: назвать цену МЕНЬШЕ, чем стоит
-- вариант. Своего склада это не касается — приписать себе ресурс нельзя,
-- списание идёт только вниз и только из своего. Оттого здесь стоят рамки
-- (потолок за шаг, свой склад, известное имя ресурса), а не сверка с
-- каталогом решений, которого на сервере нет и заводить который значило бы
-- держать весь текст хроники в двух местах.
--
-- Порядок накатов: cost → scale. Оба идемпотентные.
-- ════════════════════════════════════════════════════════════

-- ── ВРЕМЯ ДЕРЖАВЫ: занятый слот исследования ───────────────
-- Слот занимается не подложной технологией в research_slots (её потом
-- «доисследуют» и положат в research несуществующий узел), а отдельной
-- записью: пока она жива, слотов у державы на один меньше.
create table if not exists public.precursor_saga_hold (
  id         bigserial primary key,
  faction_id text not null,
  world      text not null,
  node       text,
  until      timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.precursor_saga_hold is
  'Занятый хроникой слот исследования: пока until в будущем, слотов на один меньше.';

create index if not exists idx_pc_saga_hold_fid on public.precursor_saga_hold(faction_id, until);

alter table public.precursor_saga_hold enable row level security;
drop policy if exists pcsagahold_read_own on public.precursor_saga_hold;
create policy pcsagahold_read_own on public.precursor_saga_hold
  for select using (faction_id = public._ec_my_fid());

-- Сколько слотов занято хроникой прямо сейчас.
create or replace function public._pc_saga_holds(p_fid text)
returns int language sql stable set search_path to 'public' as $$
  select count(*)::int from public.precursor_saga_hold
   where faction_id = p_fid and until > now();
$$;

-- ── СЛОТЫ ИССЛЕДОВАНИЙ: минус занятое хроникой ─────────────
-- ⚠ Тело скопировано из _technocracy.sql (последняя редакция) и отличается
-- ровно одной строкой — вычетом занятого. Если счёт слотов там поменяется,
-- поменять и здесь: иначе клиент увидит слот, которого у сервера нет.
create or replace function public._research_slots(p_fid text)
returns int language plpgsql stable security definer set search_path=public as $$
declare n int := 1; rs jsonb; a public.faction_applications;
begin
  if public._faction_is_robot(p_fid) then n := n + 1; end if;
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
  -- Хроника: обещанное внизу оплачивается временем наверху.
  n := n - public._pc_saga_holds(p_fid);
  return greatest(0, n);
end$$;
revoke all on function public._research_slots(text) from public;
grant execute on function public._research_slots(text) to authenticated;

-- ── ЦЕНА ОДНОГО ПЕРЕХОДА ───────────────────────────────────
-- p_cost: {"груз":{"id":"Дейтерий","n":13},"срок":2}
-- p_dry:  только проверить, ничего не трогая.
--
-- Возвращает {ok, err, груз:{id,n}, срок, нужно, есть}.
create or replace function public._pc_saga_cost(
  p_fid text, p_world text, p_node text, p_cost jsonb, p_dry boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id text; v_n numeric; v_срок int; v_есть numeric; v_rows int;
begin
  if p_cost is null or p_cost = '{}'::jsonb then
    return jsonb_build_object('ok', true);
  end if;

  v_id  := nullif(trim(coalesce(p_cost#>>'{груз,id}', '')), '');
  v_n   := coalesce((p_cost#>>'{груз,n}')::numeric, 0);
  -- Потолок за шаг. Самый дорогой вариант конструктора — целый груз (60), и
  -- запас втрое взят на то, что полки ещё будут дописывать. Всё, что выше, —
  -- не цена решения, а чужая рука в складе.
  v_n   := greatest(0, least(200, round(v_n, 3)));
  v_срок := greatest(0, least(5, coalesce((p_cost->>'срок')::int, 0)));

  if v_id is not null and v_n > 0 then
    if length(v_id) > 64 then
      return jsonb_build_object('ok', false, 'err', 'непонятно, чем платить');
    end if;
    select coalesce((resources->>v_id)::numeric, 0) into v_есть
      from public.faction_economy where faction_id = p_fid;
    if coalesce(v_есть, 0) < v_n then
      -- Отказ называет и цену, и остаток: игрок должен понять, чего не хватило,
      -- а не гадать, почему кнопка не сработала.
      return jsonb_build_object('ok', false,
        'err', v_id || ': нужно ' || trim(to_char(v_n, 'FM999999990.###'))
             || ', на складе ' || trim(to_char(coalesce(v_есть, 0), 'FM999999990.###')),
        'нужно', v_n, 'есть', coalesce(v_есть, 0));
    end if;
  end if;

  if p_dry then return jsonb_build_object('ok', true); end if;

  if v_id is not null and v_n > 0 then
    update public.faction_economy
       set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array[v_id],
             to_jsonb(round(coalesce((resources->>v_id)::numeric, 0) - v_n, 3)), true)
     where faction_id = p_fid
       and coalesce((resources->>v_id)::numeric, 0) >= v_n;
    -- Между проверкой и списанием склад мог опустеть с другой вкладки. Тогда
    -- перехода не будет: платит игрок или не идёт вовсе.
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      return jsonb_build_object('ok', false, 'err', v_id || ': на складе не хватило');
    end if;
  end if;

  if v_срок > 0 then
    insert into public.precursor_saga_hold (faction_id, world, node, until)
      values (p_fid, p_world, p_node, now() + (v_срок || ' days')::interval);
  end if;

  return jsonb_build_object('ok', true,
    'груз', case when v_id is not null and v_n > 0
                 then jsonb_build_object('id', v_id, 'n', v_n) end,
    'срок', v_срок);
end$$;

revoke all on function public._pc_saga_cost(text, text, text, jsonb, boolean)
  from public, anon, authenticated;

-- ── ШАГ: цена берётся ПРИ ПЕРЕХОДЕ ─────────────────────────
-- Порядок внутри важен: дописанность → срок выдержки → ЦЕНА → и только потом
-- след. Иначе за отказ платили бы складом.
drop function if exists public.precursor_saga_step(text, text, jsonb, text);
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null,
  p_cost jsonb default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb; v_cost jsonb;
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
                            'ending', p_ending, 'pay', v_pay, 'cost', v_cost);
end$$;

grant execute on function public.precursor_saga_step(text, text, jsonb, text, jsonb)
  to authenticated;

-- ── Сброс хроники снимает и её holds: перечитывать с начала, платя за
--    прошлое прохождение временем, — счёт за то, чего больше нет.
create or replace function public.precursor_saga_reset(p_world text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  delete from public.precursor_saga      where faction_id = fid and world = p_world;
  delete from public.precursor_saga_hold where faction_id = fid and world = p_world;
  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.precursor_saga_reset(text) to authenticated;
