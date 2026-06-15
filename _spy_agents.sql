-- ============================================================
-- ШПИОНАЖ · ЭТАП 1: ИМЕНОВАННЫЕ АГЕНТЫ + ЕЖЕНЕДЕЛЬНЫЙ РЫНОК РЕКРУТОВ
-- Применять в Supabase → SQL Editor. Идемпотентно, АДДИТИВНО (операции пока на
-- старом пуле agents — этап 2 переведёт их на именованных).
--
-- Модель: у фракции есть список РЕКРУТОВ (имя+фамилия+перк+цена), который раз в
-- неделю обновляется. Обновление ЛЕНИВОЕ — при открытии вкладки: если партия
-- старше 7 дней (или пуста), генерим свежую (крон не нужен — статик+Supabase).
-- Нанятый рекрут уходит в РОСТЕР (spy_agents) и +1 к пулу agents (усиление операций).
-- Потолок числа агентов = 2 + слоты Центра Спецслужб (intel-зданий).
-- Перки пока только хранятся; этап 2 сделает их гейтами/баффами операций.
-- ============================================================

-- ── Ростер нанятых агентов ──────────────────────────────────
create table if not exists public.spy_agents (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text, owner_id uuid,
  first_name  text, last_name text,
  perk        text,
  hired_at    timestamptz default now(),
  created_at  timestamptz default now()
);
create index if not exists spy_agents_fac_idx on public.spy_agents(faction_id);
alter table public.spy_agents enable row level security;
drop policy if exists "spy_agents_sel" on public.spy_agents;
create policy "spy_agents_sel" on public.spy_agents for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Еженедельный рынок рекрутов ─────────────────────────────
create table if not exists public.spy_recruits (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text, owner_id uuid,
  first_name  text, last_name text,
  perk        text, cost numeric,
  created_at  timestamptz default now()        -- метка партии (для еженедельного обновления)
);
create index if not exists spy_recruits_fac_idx on public.spy_recruits(faction_id);
alter table public.spy_recruits enable row level security;
drop policy if exists "spy_recruits_sel" on public.spy_recruits;
create policy "spy_recruits_sel" on public.spy_recruits for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Цена рекрута по перку ───────────────────────────────────
create or replace function public._spy_perk_cost(p_perk text)
returns numeric language sql immutable as $$
  select (case p_perk
    when 'analyst' then 500 when 'handler' then 550
    when 'ghost'   then 800
    when 'infiltrator' then 700 when 'saboteur' then 700
    else 600 end)::numeric
$$;

-- ── Потолок числа агентов: 2 + слоты Центра Спецслужб ───────
create or replace function public._spy_agent_cap(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select 2 + coalesce((select sum(slots_open) from public.colony_buildings
                       where faction_id=p_fid and btype='intel'),0)::int
$$;
revoke all on function public._spy_agent_cap(text) from public;
grant execute on function public._spy_agent_cap(text) to authenticated;

-- ── Список рекрутов + ростер (ленивое еженедельное обновление) ──
create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_last timestamptz; i int; fn text; ln text; pk text;
  first_names text[] := array['Алекс','Марк','Юри','Дана','Лена','Ник','Ивар','Соня','Рэй','Тао',
                              'Мира','Кай','Лев','Зара','Орин','Вера','Дрейк','Нея','Костас','Айла'];
  last_names  text[] := array['Восс','Кейн','Орлов','Драй','Морозов','Сато','Винтер','Холт','Рейес','Ким',
                              'Блэк','Норд','Айронс','Стрелков','Грей','Фокс','Маяк','Тейн','Волков','Дельгадо'];
  perks       text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid(); uid := auth.uid();

  select max(created_at) into v_last from public.spy_recruits where faction_id=fid;
  if v_last is null or v_last < now() - interval '7 days' then
    delete from public.spy_recruits where faction_id=fid;
    for i in 1..4 loop
      fn := first_names[1 + floor(random()*array_length(first_names,1))::int];
      ln := last_names[1 + floor(random()*array_length(last_names,1))::int];
      pk := perks[1 + floor(random()*array_length(perks,1))::int];
      insert into public.spy_recruits(faction_id, owner_id, first_name, last_name, perk, cost)
        values(fid, uid, fn, ln, pk, public._spy_perk_cost(pk) + floor(random()*200));
    end loop;
  end if;

  return jsonb_build_object(
    'cap',   public._spy_agent_cap(fid),
    'hired', (select count(*) from public.spy_agents where faction_id=fid),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk) order by hired_at), '[]'::jsonb)
              from public.spy_agents where faction_id=fid),
    'recruits',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk,'cost',cost) order by cost), '[]'::jsonb)
              from public.spy_recruits where faction_id=fid),
    'refresh_at', (select max(created_at) + interval '7 days' from public.spy_recruits where faction_id=fid));
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── Нанять рекрута ──────────────────────────────────────────
create or replace function public.spy_hire(p_recruit_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; me public.faction_economy; rc public.spy_recruits; cap int; have int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into rc from public.spy_recruits where id=p_recruit_id and faction_id=fid;
  if not found then raise exception 'recruit not available'; end if;

  select * into me from public.faction_economy where faction_id=fid for update;
  if not found then raise exception 'no economy'; end if;

  cap := public._spy_agent_cap(fid);
  select count(*) into have from public.spy_agents where faction_id=fid;
  if have >= cap then raise exception 'agent cap reached (% / %)', have, cap; end if;

  -- оплата (атомарно, с guard)
  update public.faction_economy set gc = gc - rc.cost where faction_id=fid and gc >= rc.cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.spy_agents(faction_id, owner_id, first_name, last_name, perk)
    values(fid, auth.uid(), rc.first_name, rc.last_name, rc.perk);
  delete from public.spy_recruits where id=p_recruit_id;
  -- именованный агент усиливает агентуру (пока операции на старом пуле)
  update public.faction_economy set agents = coalesce(agents,0) + 1 where faction_id=fid;

  return jsonb_build_object('ok',true,'agent',rc.first_name||' '||rc.last_name,'perk',rc.perk,'cost',rc.cost);
end$$;
revoke all on function public.spy_hire(uuid) from public;
grant execute on function public.spy_hire(uuid) to authenticated;

-- ── Уволить агента ──────────────────────────────────────────
create or replace function public.spy_agent_fire(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  delete from public.spy_agents where id=p_id and faction_id=fid and owner_id=auth.uid();
  if not found then raise exception 'agent not found'; end if;
  update public.faction_economy set agents = greatest(0, coalesce(agents,0) - 1) where faction_id=fid;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_agent_fire(uuid) from public;
grant execute on function public.spy_agent_fire(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- spy_recruits_list() → {cap,hired,roster,recruits,refresh_at}; список рекрутов
-- сам обновится раз в 7 дней. spy_hire(id) нанимает (−ГС, +1 агент в пул, в ростер).
