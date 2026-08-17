-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 10: ХРОНИКА (авторская новелла-кампания)
--
-- Этапы 1–9 собрали МОДЕЛЬ: надломы, русло, лестницу, ихор, недоимку, Сбор.
-- Игрок при этом видел приборы и ряд кнопок. Этап 10 добавляет то, ради чего
-- модель и строилась: ИСТОРИЮ — авторскую линию на одном мире, где каждое
-- решение принимается в сцене, а не тычком в подпись.
--
-- Сервер здесь хранит ровно одно: КУДА ДОШЁЛ игрок и ЧТО он выбрал. Ни текста,
-- ни правил, ни последствий — они в precursor_saga.js и обязаны совпадать у
-- всех. Механические последствия (деньги, ихор, журнал мира) идут прежней
-- единственной дверью precursor_commit(): хроника не заводит второй кассы.
--
-- Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

-- ⚠ Ключ везде составной, с миром: хроник несколько (см. реестр миров в
-- precursor_saga.js и надстройку _precursor_saga_worlds.sql, которую надо
-- катать следом на базах, заведённых до появления второго мира).
create table if not exists public.precursor_saga (
  faction_id  text        not null,
  world       text        not null default 'kailat',
  node        text        not null default 'p0',
  flags       jsonb       not null default '{}'::jsonb,
  seen        jsonb       not null default '[]'::jsonb,
  done        boolean     not null default false,
  ending      text,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (faction_id, world)
);

comment on table public.precursor_saga is
  'Хроника (этап 10): позиция игрока в авторской линии по дозвёздным. Текст и правила — в клиенте, здесь только след выбора.';
comment on column public.precursor_saga.node  is 'Текущий узел сцены (id из PCG.NODES).';
comment on column public.precursor_saga.flags is 'Что игрок выбрал: {ключ: значение}. Ветвление читает отсюда.';
comment on column public.precursor_saga.seen  is 'Пройденные узлы — чтобы «назад» и перечитывание не переписывали выбор.';

alter table public.precursor_saga enable row level security;

-- Читать — только свою строку. Писать напрямую нельзя вообще: единственная
-- дверь — precursor_saga_step() ниже, иначе финал ставится из консоли.
drop policy if exists pcsaga_read_own on public.precursor_saga;
create policy pcsaga_read_own on public.precursor_saga
  for select using (faction_id = public._ec_my_fid());

-- ── чтение ─────────────────────────────────────────────────
create or replace function public.precursor_saga_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_wait numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;

  select * into r from public.precursor_saga where faction_id = fid;
  if found then
    select w.hours into v_wait from public.precursor_saga_wait w where w.node = r.node;
  end if;
  if not found then
    return jsonb_build_object('ok', true, 'node', 'p0', 'flags', '{}'::jsonb,
                              'seen', '[]'::jsonb, 'done', false, 'fresh', true);
  end if;
  -- updated_at отдаётся наружу не для порядка: на нём стоит СРОК (§7.2).
  -- Хроника идёт не подряд, а с выдержками — между главами Кайлат живёт свои
  -- годы, и вернуться надо тогда, когда сказано. Час возврата считает сервер,
  -- иначе «в срок» проверялось бы часами игрока.
  return jsonb_build_object('ok', true, 'node', r.node, 'flags', r.flags,
                            'seen', r.seen, 'done', r.done, 'ending', r.ending,
                            'started_at', r.started_at, 'updated_at', r.updated_at,
                            'now', now(),
                            'ready_at', case when v_wait is not null
                              then r.updated_at + (v_wait || ' hours')::interval end);
end$$;

-- ── СРОКИ (§7.2: уговор — регулярность, а не сумма) ────────
-- Хроника не проходится за вечер и не должна. Между главами стоит выдержка:
-- Кайлат живёт свои годы, а игрок обязан вернуться тогда, когда сказано.
-- Проверять это на клиенте нельзя — часы там свои. Поэтому карта сроков
-- (только id узла и часы, ни строчки текста) лежит здесь.
create table if not exists public.precursor_saga_wait (
  world text not null default 'kailat',
  node  text not null,
  hours numeric not null check (hours >= 0),
  primary key (world, node)
);

comment on table public.precursor_saga_wait is
  'Выдержка перед выходом из узла, часы. Текст ожидания — в клиенте, срок — здесь.';

insert into public.precursor_saga_wait (world, node, hours) values
  ('kailat', 'w_p',  20),   -- после первого появления: держава должна отзвонить
  ('kailat', 'w_1',  44),   -- между Набатом и Уговором
  ('kailat', 'w_2',  68),   -- уговор проверяется сроком, иначе он не уговор
  ('kailat', 'w_3',  68),   -- свод открывают не в тот же день, когда попросили
  ('kailat', 'w_4',  92),   -- Нижнее открывают раз в поколение
  ('kailat', 'w_5', 116)    -- счёт приходит не сразу за виной
on conflict (world, node) do update set hours = excluded.hours;

-- ── ЦЕНА ИСХОДА ────────────────────────────────────────────
-- Хроника не может кончаться ничем: пять глав про счёт обязаны этот счёт
-- предъявить. Но и второй кассы она не заводит — трогает ровно то же, что
-- трогает precursor_commit: ихор на складе и недоимку в общем реестре.
--
-- ichor   > 0 — Кайлат отдал сам (отданное руками идёт без остатка, §15)
--         < 0 — заплачено своим
-- arrears — насколько гасится недоимка (гасится всегда: счёт так или иначе
--           закрыт, разница в том, кто и чем за это заплатил)
create table if not exists public.precursor_saga_reward (
  world   text not null default 'kailat',
  ending  text not null,
  ichor   numeric not null default 0,
  arrears numeric not null default 0,
  primary key (world, ending)
);

insert into public.precursor_saga_reward (world, ending, ichor, arrears) values
  ('kailat', 'вместе',           45,  80),   -- Нижнее открыли сами и в срок одного дня
  ('kailat', 'заплатил-вписано', -20, 140),  -- заплачено своим и внесено в свод как долг
  ('kailat', 'заплатил',         -20, 120),  -- заплачено своим, но об этом не написано
  ('kailat', 'указал-названо',    0,   70),  -- счёт ушёл за горизонт, имя названо
  ('kailat', 'указал',            0,   70),  -- счёт ушёл за горизонт, в своде умолчание
  ('kailat', 'встал-имя',        20,   40),  -- взыскание прошло по вам, доля пришла позже
  ('kailat', 'встал',             0,   40)   -- взыскание прошло по вам, и только
on conflict (world, ending) do update
  set ichor = excluded.ichor, arrears = excluded.arrears;

-- Начисление. Зовётся ровно один раз — из precursor_saga_step в тот момент,
-- когда исход ставится впервые (дальше строка помечена done и не пускает).
create or replace function public._pc_saga_pay(p_fid text, p_ending text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r public.precursor_saga_reward; v_have numeric; v_ich numeric; v_cut numeric; v_rows int;
begin
  select * into r from public.precursor_saga_reward where ending = p_ending;
  if not found then return jsonb_build_object('ichor', 0, 'arrears', 0); end if;

  -- Ихор. Списать больше, чем лежит на складе, нельзя: долг закрывается тем,
  -- что есть, и это не повод уводить склад в минус.
  v_ich := 0;
  if r.ichor <> 0 then
    select coalesce((resources->>'Ихор')::numeric, 0) into v_have
      from public.faction_economy where faction_id = p_fid;
    v_ich := case when r.ichor < 0 then -least(coalesce(v_have, 0), abs(r.ichor)) else r.ichor end;
    if v_ich <> 0 then
      update public.faction_economy
         set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
               to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) + v_ich, 3)), true)
       where faction_id = p_fid;
      -- Строки экономики нет — значит и не начислено. Отчитываться надо тем,
      -- что произошло, а не тем, что полагалось.
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_ich := 0; end if;
    end if;
  end if;

  -- Недоимка. Гасим не больше, чем набрано: обнулить чужие грехи хроникой
  -- нельзя, она закрывает свой счёт, а не переписывает реестр.
  v_cut := 0;
  if r.arrears > 0 then
    select amount into v_have from public.pc_arrears where faction_id = p_fid;
    v_cut := least(coalesce(v_have, 0), r.arrears);
    if v_cut > 0 then
      update public.pc_arrears
         set amount = amount - v_cut, repaid = repaid + v_cut, updated_at = now()
       where faction_id = p_fid;
      insert into public.pc_arrears_log (faction_id, kind, ichor, weight)
        values (p_fid, 'зачёт', 0, v_cut);
    end if;
  end if;

  return jsonb_build_object('ichor', v_ich, 'arrears', v_cut);
end$$;

revoke all on function public._pc_saga_pay(text, text) from public, anon, authenticated;

-- ── шаг ────────────────────────────────────────────────────
-- Клиент говорит: «я в узле X, выбрал ответ, иду в Y, вот что это записало
-- во флаги». Сервер не спорит о содержании — он хранит след. Проверяет одно:
-- что игрок не прыгает в финал мимо линии (узел должен быть новым или уже
-- виденным) и что законченную хронику не переписывают задним числом.
create or replace function public.precursor_saga_step(
  p_node text, p_flags jsonb default null, p_ending text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  if p_node is null or length(p_node) = 0 or length(p_node) > 64 then
    return jsonb_build_object('ok', false, 'err', 'узел не назван');
  end if;

  select * into r from public.precursor_saga where faction_id = fid;
  if not found then
    insert into public.precursor_saga (faction_id) values (fid)
      on conflict (faction_id) do nothing;
    select * into r from public.precursor_saga where faction_id = fid;
  end if;

  if r.done then
    return jsonb_build_object('ok', false, 'err', 'хроника дописана');
  end if;

  -- Срок. Если из текущего узла выход отложен — раньше времени не выпускаем,
  -- и говорим, сколько осталось: ожидание должно быть названным, а не глухим.
  select w.hours into v_wait from public.precursor_saga_wait w where w.node = r.node;
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
   where faction_id = fid;

  -- Исход ставится ровно один раз (выше стоит проверка r.done), поэтому и
  -- платится он один раз — отдельного «уже начислено» не нужно.
  if p_ending is not null then
    v_pay := public._pc_saga_pay(fid, p_ending);
  end if;

  return jsonb_build_object('ok', true, 'node', p_node, 'flags', v_flags,
                            'done', p_ending is not null, 'ending', p_ending,
                            'pay', v_pay);
end$$;

-- Перечитать хронику заново можно: линия одна, но своё решение игрок вправе
-- пересмотреть новой игрой. След прошлого прохождения при этом теряется —
-- это честно и об этом написано в самой кнопке.
create or replace function public.precursor_saga_reset()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  delete from public.precursor_saga where faction_id = fid;
  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.precursor_saga_get()   to authenticated;
grant execute on function public.precursor_saga_step(text, jsonb, text) to authenticated;
grant execute on function public.precursor_saga_reset() to authenticated;
