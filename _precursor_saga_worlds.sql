-- ════════════════════════════════════════════════════════════
-- ХРОНИКА · НЕСКОЛЬКО МИРОВ (надстройка над _precursor_saga.sql)
--
-- Было: одна строка на державу — одна хроника на всех, Кайлат.
-- Стало: хроник может быть много, каждая со своим следом. Ключ везде
-- дополняется миром: и позиция игрока, и сроки между главами, и цена исхода.
--
-- Почему сроки и цена тоже: id узлов ('w_1', 'p0') и имена исходов у миров
-- свои и обязаны иметь право совпасть. Без мира в ключе второй мир молча
-- забрал бы выдержки и награды первого.
--
-- Существующие строки достаются Кайлату — он и был единственным миром.
-- Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

-- ── позиция игрока ─────────────────────────────────────────
alter table public.precursor_saga
  add column if not exists world text not null default 'kailat';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.precursor_saga'::regclass
       and contype = 'p'
       and conname = 'precursor_saga_pkey'
       and array_length(conkey, 1) = 1
  ) then
    alter table public.precursor_saga drop constraint precursor_saga_pkey;
    alter table public.precursor_saga add primary key (faction_id, world);
  end if;
end$$;

comment on column public.precursor_saga.world is
  'Какая хроника: id мира из реестра клиента (PrecursorSaga.register). Старое — kailat.';

-- ── сроки между главами ────────────────────────────────────
alter table public.precursor_saga_wait
  add column if not exists world text not null default 'kailat';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.precursor_saga_wait'::regclass
       and contype = 'p' and array_length(conkey, 1) = 1
  ) then
    alter table public.precursor_saga_wait drop constraint precursor_saga_wait_pkey;
    alter table public.precursor_saga_wait add primary key (world, node);
  end if;
end$$;

-- ── цена исхода ────────────────────────────────────────────
alter table public.precursor_saga_reward
  add column if not exists world text not null default 'kailat';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.precursor_saga_reward'::regclass
       and contype = 'p' and array_length(conkey, 1) = 1
  ) then
    alter table public.precursor_saga_reward drop constraint precursor_saga_reward_pkey;
    alter table public.precursor_saga_reward add primary key (world, ending);
  end if;
end$$;

-- ── чтение: разом обо всех хрониках ────────────────────────
-- Дверь в досье рисует карточку на каждый мир, и спрашивать сервер по разу
-- на мир значит платить запросом за каждую строку списка. Отдаём все следы
-- одним ответом; мира, в который игрок не заходил, в ответе просто нет.
drop function if exists public.precursor_saga_get();
create or replace function public.precursor_saga_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; v_rows jsonb;
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
    left join public.precursor_saga_wait w
      on w.world = r.world and w.node = r.node
   where r.faction_id = fid;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'now', now());
end$$;

-- ── начисление ─────────────────────────────────────────────
create or replace function public._pc_saga_pay(p_fid text, p_world text, p_ending text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r public.precursor_saga_reward; v_have numeric; v_ich numeric; v_cut numeric; v_rows int;
begin
  select * into r from public.precursor_saga_reward
   where world = p_world and ending = p_ending;
  if not found then return jsonb_build_object('ichor', 0, 'arrears', 0); end if;

  -- Ихор. Списать больше, чем лежит на складе, нельзя.
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
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_ich := 0; end if;
    end if;
  end if;

  -- Недоимка. Гасим не больше, чем набрано.
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

revoke all on function public._pc_saga_pay(text, text, text) from public, anon, authenticated;
drop function if exists public._pc_saga_pay(text, text);

-- ── шаг ────────────────────────────────────────────────────
drop function if exists public.precursor_saga_step(text, jsonb, text);
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  if p_world is null or length(p_world) = 0 or length(p_world) > 32 then
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

  select w.hours into v_wait from public.precursor_saga_wait w
   where w.world = p_world and w.node = r.node;
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

-- ── сброс: только названной хроники ────────────────────────
drop function if exists public.precursor_saga_reset();
create or replace function public.precursor_saga_reset(p_world text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  delete from public.precursor_saga where faction_id = fid and world = p_world;
  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.precursor_saga_get() to authenticated;
grant execute on function public.precursor_saga_step(text, text, jsonb, text) to authenticated;
grant execute on function public.precursor_saga_reset(text) to authenticated;
