-- ============================================================
-- АДМИН-УПРАВЛЕНИЕ ПРОФИЛЯМИ (имя / удаление).
--
-- Причина бага: смена ника чужого профиля шла POST-ом с
-- Prefer: resolution=merge-duplicates. PostgREST резолвит конфликт
-- по первичному ключу таблицы (не по email), поэтому upsert не
-- находил существующую строку и пытался вставить новую с уже
-- занятым email → ERROR duplicate key "profiles_email_key".
--
-- Решение: SECURITY DEFINER функции — обходят RLS, проверяют, что
-- вызывающий superadmin, и делают явный UPDATE по email (INSERT,
-- только если профиля ещё нет). Выполнить целиком в Supabase SQL Editor.
-- ============================================================

-- Серверный фильтр имён (страховка от обхода клиента): ненормативная лексика +
-- явно противоправное. Нормализация: lower + удаление не-букв (ловит «х у й»).
create or replace function public._name_violates(p text) returns boolean
language sql immutable as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-zа-яё]', '', 'g') ~
    '(хуй|хую|хуи|пизд|ебло|ебля|выеб|наеб|уеб|ебат|ебал|ебуч|ебут|бляд|блят|сука|суки|мудак|мудил|залуп|гондон|гандон|пидор|пидар|педик|жоп|говн|дроч|долбоёб|долбоеб|еблан|шлюх|нахуй|похуй|нихуя|гитлер|рейх|нацист|нацизм|фашист|фашизм|свастик|игил|террор|педофил|зоофил|hui|huy|huj|xyu|blyad|blya|pidor|pidar|pedik|suka|syka|ebat|ebal|eblan|mudak|nahui|pohui|gandon|gondon|gitler|nazi|fashist|svastik)'
$$;

-- Сменить отображаемое имя профиля по email.
create or replace function public.admin_set_profile_name(p_email text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin') then
    raise exception 'forbidden: superadmin only';
  end if;
  if p_email is null or p_email = '' then
    raise exception 'email required';
  end if;
  if public._name_violates(p_name) then raise exception 'name violates content policy'; end if;
  update public.profiles set display_name = p_name where email = p_email;
  if not found then
    insert into public.profiles (email, display_name) values (p_email, p_name);
  end if;
end$$;
revoke all on function public.admin_set_profile_name(text, text) from public;
grant execute on function public.admin_set_profile_name(text, text) to authenticated;

-- Сохранить СВОЙ профиль (имя + аватар). Любой залогиненный пишет только свою
-- строку — email берётся из JWT, не от клиента. Надёжный upsert по email
-- (прежний POST merge-duplicates падал на profiles_email_key и молча терялся).
create or replace function public.set_my_profile(p_name text, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare em text;
begin
  em := auth.jwt() ->> 'email';
  if em is null or em = '' then raise exception 'not authenticated'; end if;
  if public._name_violates(p_name) then raise exception 'name violates content policy'; end if;
  update public.profiles set display_name = p_name, avatar_url = p_avatar where email = em;
  if not found then
    insert into public.profiles (email, display_name, avatar_url) values (em, p_name, p_avatar);
  end if;
end$$;
revoke all on function public.set_my_profile(text, text) from public;
grant execute on function public.set_my_profile(text, text) to authenticated;

-- Переименовать колонию/планету в ЕДИНОМ источнике истины: обновляет и
-- public.colonies.planet_name, и соответствующую запись в map_systems.planets.
-- Права: владелец колонии или стафф. Так имя меняется сразу везде (карта,
-- фракции, кабинет), а не только в анкете.
create or replace function public.rename_colony(p_colony_id uuid, p_new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare col public.colonies; nm text;
begin
  nm := nullif(btrim(p_new_name), '');
  if nm is null then raise exception 'empty name'; end if;
  if public._name_violates(nm) then raise exception 'name violates content policy'; end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if not (col.owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator')) then
    raise exception 'forbidden';
  end if;
  -- переименовать планету на карте (по старому имени в системе колонии)
  update public.map_systems ms
    set planets = (
      select jsonb_agg(case when e->>'name' = col.planet_name then jsonb_set(e, '{name}', to_jsonb(nm)) else e end)
      from jsonb_array_elements(ms.planets) e)
    where ms.id = col.system_id
      and exists (select 1 from jsonb_array_elements(ms.planets) e2 where e2->>'name' = col.planet_name);
  -- переименовать колонию
  update public.colonies set planet_name = nm where id = p_colony_id;
end$$;
revoke all on function public.rename_colony(uuid, text) from public;
grant execute on function public.rename_colony(uuid, text) to authenticated;

-- Удалить профиль игрока по email (имя/аватар; аккаунт и роль не трогаются).
create or replace function public.admin_delete_profile(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin') then
    raise exception 'forbidden: superadmin only';
  end if;
  delete from public.profiles where email = p_email;
end$$;
revoke all on function public.admin_delete_profile(text) from public;
grant execute on function public.admin_delete_profile(text) to authenticated;
