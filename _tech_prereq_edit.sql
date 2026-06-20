-- ============================================================
-- РЕДАКТОР СВЯЗЕЙ ДЕРЕВА (prereq) — staff добавляет/удаляет пути.
--
-- Связи (что нужно изучить раньше) — это ГЕЙМПЛЕЙ, а не косметика: сервер
-- валидирует исследования по public.tech_nodes.prereq (см. _security_research.sql).
-- Поэтому правка пути должна попадать И в каталог tech_nodes (для серверной
-- проверки), И в overlay-таблицу tech_prereq (чтобы клиент знал про override и
-- мог отрисовать/сбросить связь). Дефолтные связи генерит ecBuildResearch() —
-- их мы НЕ дублируем; tech_prereq хранит только staff-правки.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _security_research.sql и
-- _research_queue.sql (там создаётся/наполняется tech_nodes). Идемпотентно.
-- ============================================================

create table if not exists public.tech_prereq (
  node_id    text primary key,
  prereq     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tech_prereq enable row level security;

-- Override-связи — не секрет: читают все (каталог дерева).
drop policy if exists "tp_sel" on public.tech_prereq;
create policy "tp_sel" on public.tech_prereq for select to public using (true);

-- Прямой DML — только staff (основной путь записи — RPC ниже).
drop policy if exists "tp_write" on public.tech_prereq;
create policy "tp_write" on public.tech_prereq for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Задать связи узла (staff) ────────────────────────────────
-- p_prereq — ПОЛНЫЙ массив id-предшественников узла (клиент шлёт целиком).
-- Пишем и в overlay, и в каталог tech_nodes — чтобы сервер валидировал по нему.
create or replace function public.tech_prereq_set(p_node text, p_prereq jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  if jsonb_typeof(coalesce(p_prereq,'[]'::jsonb)) <> 'array' then
    raise exception 'prereq must be a json array';
  end if;

  insert into public.tech_prereq(node_id, prereq, updated_at)
    values (p_node, coalesce(p_prereq,'[]'::jsonb), now())
  on conflict (node_id) do update set prereq = excluded.prereq, updated_at = now();

  -- зеркало в каталог: СЕРВЕР проверяет исследования по tech_nodes.prereq
  update public.tech_nodes set prereq = coalesce(p_prereq,'[]'::jsonb) where node_id = p_node;
end$$;
revoke all on function public.tech_prereq_set(text,jsonb) from public;
grant execute on function public.tech_prereq_set(text,jsonb) to authenticated;

-- ── Сброс связей узла к дефолту (staff) ──────────────────────
-- p_default — дефолтные связи из ecBuildResearch() (клиент знает их и шлёт).
-- Удаляем override и возвращаем каталог к дефолту.
create or replace function public.tech_prereq_reset(p_node text, p_default jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  delete from public.tech_prereq where node_id = p_node;
  update public.tech_nodes set prereq = coalesce(p_default,'[]'::jsonb) where node_id = p_node;
end$$;
revoke all on function public.tech_prereq_reset(text,jsonb) from public;
grant execute on function public.tech_prereq_reset(text,jsonb) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select * from public.tech_prereq order by updated_at desc;
-- select public.tech_prereq_set('cls.ship.cruiser', '["cls.ship.destroyer"]'::jsonb);
