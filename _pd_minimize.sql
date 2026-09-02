-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════════════════
-- МИНИМИЗАЦИЯ ПЕРСОНАЛЬНЫХ ДАННЫХ (ФЗ-152 ст.5 ч.5, ст.5 ч.7 / GDPR ст.5)
--
-- ЗАЧЕМ: Google-вход приносит в базу больше, чем нужно игре: имя из
-- Google-аккаунта, ссылку на фото профиля (googleusercontent), почту —
-- и всё это дублируется по игровым таблицам. Чем меньше ПД лежит, тем
-- меньше объём обязанностей оператора и цена утечки.
--
-- ЧТО ОСТАЁТСЯ (и почему это необходимо):
--   • auth.users.email    — логин, без него вход не работает (ст.6 ч.1 п.5);
--   • auth.identities.sub / provider_id — связка с Google, тот самый «только sub»;
--   • profiles.display_name / avatar_url — позывной и аватар, заданные САМИМ игроком;
--   • access_log.ip / fingerprint — антимультиакк, законный интерес, но
--     теперь со СРОКОМ ХРАНЕНИЯ (было «вечно» — прямое нарушение ст.5 ч.7).
--
-- ЧТО ВЫЧИЩАЕТСЯ:
--   • Google-метаданные (name, full_name, picture, given/family_name)
--     из auth.users.raw_user_meta_data и auth.identities.identity_data;
--   • аватары-хотлинки на googleusercontent.com (каждый рендер страницы
--     сообщал Google, что игрок онлайн) → заменяются инициалами;
--   • дубли почты в игровых таблицах: faction_units, faction_deletions,
--     tickets, dev_tasks, legal_consents;
--   • access_log.email (там уже есть user_id) + записи старше 180 суток.
--
-- ЧТО НЕ ТРОГАЕМ: signup_requests.email — без него нельзя одобрить заявку
-- на почтовый вход; profiles.email — на нём висят легаси-RPC админки
-- (admin_set_profile_name / admin_delete_profile по почте).
--
-- Идемпотентно. Прогон: node tools/db_run.js _pd_minimize.sql
-- ════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- 1. Чистка Google-метаданных в auth.users
--    Оставляем ТОЛЬКО ключи, которые ставит сам игрок через set_my_profile:
--    display_name и avatar_url (и то — если аватар не хотлинк на Google).
-- ────────────────────────────────────────────────────────────────────────
create or replace function public._pd_strip_user_meta(m jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(
    (select jsonb_object_agg(k, v)
       from jsonb_each(coalesce(m, '{}'::jsonb)) as e(k, v)
      where k in ('display_name', 'avatar_url')
        and not (k = 'avatar_url' and (v #>> '{}') like '%googleusercontent.com%')),
    '{}'::jsonb);
$fn$;
comment on function public._pd_strip_user_meta(jsonb) is
  'ФЗ-152: оставляет в метаданных аккаунта только то, что задал сам игрок.';

update auth.users
   set raw_user_meta_data = public._pd_strip_user_meta(raw_user_meta_data)
 where raw_user_meta_data is not null
   and raw_user_meta_data <> public._pd_strip_user_meta(raw_user_meta_data);

-- Страховка: следующий вход через Google снова принесёт name/picture —
-- триггер срезает их на лету, до того как они лягут в таблицу.
create or replace function public._pd_users_meta_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.raw_user_meta_data := public._pd_strip_user_meta(new.raw_user_meta_data);
  return new;
end$fn$;

drop trigger if exists trg_pd_users_meta_guard on auth.users;
create trigger trg_pd_users_meta_guard
  before insert or update of raw_user_meta_data on auth.users
  for each row execute function public._pd_users_meta_guard();

-- ────────────────────────────────────────────────────────────────────────
-- 2. auth.identities — «только sub»
--    ВАЖНО: email в identity_data оставляем. GoTrue по нему связывает
--    Google-вход с уже существующим аккаунтом; выбросив его, мы разорвём
--    связку и старые игроки войдут «новыми», потеряв державы.
--    Всё остальное от Google (name, picture, given/family_name,
--    email_verified, iss, hd) — вон.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public._pd_strip_identity(d jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(
    (select jsonb_object_agg(k, v)
       from jsonb_each(coalesce(d, '{}'::jsonb)) as e(k, v)
      where k in ('sub', 'email', 'provider_id')),
    '{}'::jsonb);
$fn$;
comment on function public._pd_strip_identity(jsonb) is
  'ФЗ-152: в данных внешнего входа остаются sub (идентификатор) и email (связка аккаунта).';

update auth.identities
   set identity_data = public._pd_strip_identity(identity_data)
 where identity_data is not null
   and identity_data <> public._pd_strip_identity(identity_data);

create or replace function public._pd_identity_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.identity_data := public._pd_strip_identity(new.identity_data);
  return new;
end$fn$;

drop trigger if exists trg_pd_identity_guard on auth.identities;
create trigger trg_pd_identity_guard
  before insert or update of identity_data on auth.identities
  for each row execute function public._pd_identity_guard();

-- ────────────────────────────────────────────────────────────────────────
-- 3. profiles.avatar_url — снять хотлинки на Google
--    Игрок увидит инициалы вместо гугл-фото; свой загруженный аватар цел.
-- ────────────────────────────────────────────────────────────────────────
update public.profiles
   set avatar_url = null
 where avatar_url like '%googleusercontent.com%';

-- ────────────────────────────────────────────────────────────────────────
-- 4. Дубли почты в игровых таблицах.
--    Везде рядом уже лежит user_id/owner_id — почта там лишняя копия.
--    Колонки НЕ удаляем (совместимость со старым клиентом и select=*),
--    но обнуляем и вешаем триггер-страховку от повторной записи.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public._pd_blank_email()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare col text := tg_argv[0]; j jsonb;
begin
  j := to_jsonb(new);
  if (j ->> col) like '%@%' then
    new := jsonb_populate_record(new, j || jsonb_build_object(col, null));
  end if;
  return new;
end$fn$;
comment on function public._pd_blank_email() is
  'ФЗ-152: не даёт клиенту записать e-mail в игровую таблицу (авторство — по user_id).';

do $do$
declare t record;
begin
  for t in
    select * from (values
      ('faction_units',     'owner_email'),
      ('faction_deletions', 'owner_email'),
      ('tickets',           'user_email'),
      ('dev_tasks',         'created_email'),
      ('legal_consents',    'email')
    ) as v(tbl, col)
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=t.tbl and column_name=t.col) then
      continue;
    end if;
    execute format('alter table public.%I alter column %I drop not null', t.tbl, t.col);
    execute format('update public.%I set %I = null where %I like ''%%@%%''', t.tbl, t.col, t.col);
    execute format('drop trigger if exists trg_pd_noemail on public.%I', t.tbl);
    execute format('create trigger trg_pd_noemail before insert or update on public.%I '
                   'for each row execute function public._pd_blank_email(%L)', t.tbl, t.col);
  end loop;
end$do$;

-- legal_accept больше не пишет почту: доказательство акцепта — это user_id,
-- дата и версия документа. Почта в журнале согласий ничего не доказывает.
create or replace function public.legal_accept(p_docs jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_rec jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  for v_rec in select * from jsonb_array_elements(p_docs)
  loop
    insert into public.legal_consents (user_id, doc_slug, doc_version)
    values (v_uid, v_rec->>'slug', v_rec->>'version')
    on conflict (user_id, doc_slug, doc_version) do nothing;
  end loop;
end$fn$;
revoke all on function public.legal_accept(jsonb) from public;
grant execute on function public.legal_accept(jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5. access_log — срок хранения и снятие дубля почты
--    ст.5 ч.7 ФЗ-152: данные хранятся не дольше, чем нужно для цели.
--    Цель — ловить мультиаккаунты; 180 суток для этого с запасом.
-- ────────────────────────────────────────────────────────────────────────
update public.access_log set email = null where email is not null;

create or replace function public.access_log_prune()
returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  delete from public.access_log where created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end$fn$;
comment on function public.access_log_prune() is
  'ФЗ-152 ст.5 ч.7: удаляет записи журнала доступа старше 180 суток. Крон раз в сутки.';
revoke all on function public.access_log_prune() from public, anon, authenticated;

select public.access_log_prune();

-- Суточный крон, если pg_cron доступен (на Supabase — да).
do $do$
begin
  perform cron.schedule('access-log-prune', '17 3 * * *',
                        'select public.access_log_prune()');
exception when others then
  raise notice 'pg_cron недоступен — звать access_log_prune() вручную: %', sqlerrm;
end$do$;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Право на удаление (ст.14 ФЗ-152 / ст.17 GDPR) — самообслуживание.
--    Игрок сам сносит свои учётные данные: профиль, согласия, журнал.
--    Игровой контент остаётся обезличенным (иначе развалится мир у других).
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.pd_erase_me()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_em text := auth.jwt() ->> 'email';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  delete from public.access_log     where user_id = v_uid;
  delete from public.legal_consents where user_id = v_uid;
  begin
    delete from public.signup_requests where email = v_em;
  exception when others then null;
  end;
  update public.profiles set display_name = null, avatar_url = null, email = null
   where user_id = v_uid;
  update auth.users set raw_user_meta_data = '{}'::jsonb where id = v_uid;

  return jsonb_build_object('ok', true, 'user_id', v_uid,
    'note', 'Учётные данные обезличены. Полное удаление аккаунта — по обращению к оператору.');
end$fn$;
revoke all on function public.pd_erase_me() from public;
grant execute on function public.pd_erase_me() to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 7. Право на доступ (ст.14 ФЗ-152 / ст.15 GDPR) — выгрузка своих данных.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.pd_export_me()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  return jsonb_build_object(
    'account',  (select jsonb_build_object('id', id, 'email', email,
                        'created_at', created_at, 'last_sign_in_at', last_sign_in_at)
                   from auth.users where id = v_uid),
    'profile',  (select to_jsonb(p) - 'id' from public.profiles p where p.user_id = v_uid),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c) - 'id'), '[]'::jsonb)
                   from public.legal_consents c where c.user_id = v_uid),
    'access_log', (select coalesce(jsonb_agg(to_jsonb(a) - 'id'), '[]'::jsonb)
                   from public.access_log a where a.user_id = v_uid)
  );
end$fn$;
revoke all on function public.pd_export_me() from public;
grant execute on function public.pd_export_me() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Проверка после наката (всё должно быть 0):
--   select count(*) from auth.users where raw_user_meta_data ?| array['name','picture','full_name','email'];
--   select count(*) from auth.identities where identity_data ?| array['name','picture'];
--   select count(*) from public.access_log where email is not null;
--   select count(*) from public.faction_units where owner_email like '%@%';
-- ════════════════════════════════════════════════════════════════════════
