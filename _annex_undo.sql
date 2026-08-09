-- ============================================================
-- РАЗЪЕДИНЕНИЕ ДЕРЖАВ — расторжение унии с реституцией
-- Применять СТРОГО ПОСЛЕ _annex.sql. Идемпотентно.
--
-- Слияние было необратимо ровно потому, что после переброса faction_id
-- строка «колония X» ничем не отличалась от исконной колонии старшей:
-- знали мы только владельца системы (map_systems.union_origin).
--
-- Здесь слияние начинает вести РЕЕСТР ПРОИСХОЖДЕНИЯ: на каждую
-- перенесённую строку пишется таблица, первичный ключ и прежний fid.
-- Разъединение проходит по реестру в обратную сторону и возвращает
-- младшей державе ровно то, что она принесла — не больше и не меньше.
--
-- Чего реституция НЕ возвращает и почему:
--   • нажитое ПОСЛЕ слияния остаётся старшей: общая казна строила это
--     сообща, и делить построенное задним числом нечем;
--   • технологии остаются у обеих: знание нельзя разучить обратно,
--     и это единственный «подарок», который уния оставляет навсегда;
--   • казна и ресурсы возвращаются по снимку на момент слияния, но не
--     больше того, что есть у старшей сейчас — иначе расторжение стало бы
--     способом печатать ГС из воздуха.
-- ============================================================

-- ── Снимок казны младшей на момент слияния ──────────────────
alter table public.state_annexations add column if not exists minor_snapshot jsonb;
-- ── Реестр происхождения перенесённых строк ─────────────────
create table if not exists public.annex_origin (
  id bigserial primary key,
  annex_id uuid not null references public.state_annexations(id) on delete cascade,
  tbl      text not null,          -- имя таблицы в public
  pk_col   text not null,          -- имя однопольного первичного ключа
  pk_val   text not null,          -- значение ключа в текстовом виде
  prev_fid text not null           -- чей был faction_id до слияния
);
create index if not exists ao_annex_idx on public.annex_origin(annex_id, tbl);
alter table public.annex_origin enable row level security;
drop policy if exists "ao_sel" on public.annex_origin;
create policy "ao_sel" on public.annex_origin for select to authenticated using (false);
-- Читать реестр клиентам незачем: он служебный, работают с ним только RPC.

-- ── Однопольный первичный ключ таблицы (или null) ───────────
create or replace function public._annex_pk(p_tbl text)
returns text language sql stable security definer set search_path=public as $$
  select a.attname
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
  where n.nspname = 'public' and c.relname = p_tbl
    and i.indisprimary and i.indnatts = 1
  limit 1
$$;
revoke all on function public._annex_pk(text) from public;

-- ── ПЕРЕОПРЕДЕЛЕНИЕ: слияние теперь ведёт реестр ────────────
-- Сигнатура получила p_annex_id: без него запись в реестр не к чему
-- привязать. Старая двухаргументная версия остаётся жить как обёртка
-- для ручных вызовов — она просто сливает без права на откат.
create or replace function public._annex_merge(p_lead text, p_minor text, p_annex_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record; t text; pk text; moved int;
begin
  -- 1) Снимок казны младшей ДО слияния — по нему пойдёт реституция
  if p_annex_id is not null then
    begin
      update public.state_annexations set minor_snapshot = (
        select jsonb_build_object('gc', coalesce(e.gc,0),
                                  'resources', coalesce(e.resources,'{}'::jsonb),
                                  'research', coalesce(e.research,'[]'::jsonb))
        from public.faction_economy e where e.faction_id = p_minor)
      where id = p_annex_id;
    exception when others then raise notice 'annex snapshot: %', sqlerrm; end;
  end if;

  -- 2) Казна, ресурсы, исследования
  begin
    update public.faction_economy le set
      gc = coalesce(le.gc,0) + coalesce(me.gc,0),
      resources = (
        select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb) from (
          select key as k, sum(value::numeric) as v from (
            select * from jsonb_each_text(coalesce(le.resources,'{}'::jsonb))
            union all
            select * from jsonb_each_text(coalesce(me.resources,'{}'::jsonb))
          ) x group by key
        ) s
      ),
      research = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
          select jsonb_array_elements(coalesce(le.research,'[]'::jsonb)) e
          union all
          select jsonb_array_elements(coalesce(me.research,'[]'::jsonb))
        ) u
      )
    from public.faction_economy me
    where le.faction_id = p_lead and me.faction_id = p_minor;
    update public.faction_economy set gc = 0, resources = '{}'::jsonb
      where faction_id = p_minor;
  exception when others then raise notice 'annex economy: %', sqlerrm; end;

  -- 3) Территория: union_origin помнит исходного владельца и без реестра
  begin
    alter table public.map_systems add column if not exists union_origin text;
  exception when others then null; end;
  begin
    update public.map_systems
      set union_origin = coalesce(union_origin, faction), faction = p_lead
      where faction = p_minor;
  exception when others then raise notice 'annex systems: %', sqlerrm; end;

  -- 4) Всё, что помечено faction_id. Перед переносом пишем реестр:
  --    таблица + первичный ключ + прежний fid. Таблицы без однопольного
  --    первичного ключа переносятся БЕЗ записи (вернуть их нечем) —
  --    об этом честно предупреждаем в notice.
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='faction_id'
      and c.data_type in ('text','character varying')
      and c.table_name not in ('faction_applications','faction_economy',
                               'state_unions','state_annexations','annex_origin',
                               'faction_members')
  loop
    t := r.table_name;
    pk := public._annex_pk(t);
    begin
      if p_annex_id is not null and pk is not null then
        execute format(
          'insert into public.annex_origin(annex_id, tbl, pk_col, pk_val, prev_fid)
             select $1, $2, $3, %I::text, faction_id from public.%I where faction_id = $4',
          pk, t) using p_annex_id, t, pk, p_minor;
      elsif p_annex_id is not null then
        raise notice 'annex % : нет однопольного PK, откат для этой таблицы невозможен', t;
      end if;
      execute format('update public.%I set faction_id = $1 where faction_id = $2', t)
        using p_lead, p_minor;
      get diagnostics moved = row_count;
    exception when others then raise notice 'annex % : %', t, sqlerrm; end;
  end loop;
end$$;
revoke all on function public._annex_merge(text,text,uuid) from public;

-- Совместимость: старый двухаргументный вызов = слияние без реестра.
create or replace function public._annex_merge(p_lead text, p_minor text)
returns void language sql security definer set search_path=public as $$
  select public._annex_merge(p_lead, p_minor, null::uuid)
$$;
revoke all on function public._annex_merge(text,text) from public;

-- ── ПЕРЕОПРЕДЕЛЕНИЕ: согласие передаёт id соглашения в слияние ──
create or replace function public.annex_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; a public.state_annexations;
        v_minor_owner uuid; v_lead_name text; v_minor_name text; v_lead_color text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  if v_fid is null then raise exception 'только владелец державы'; end if;
  select * into a from public.state_annexations where id=p_id and status='pending';
  if not found then raise exception 'предложение не найдено'; end if;
  if a.minor_fid <> v_fid then raise exception 'это не ваше предложение'; end if;

  if not p_accept then
    update public.state_annexations set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'joined',false);
  end if;

  select owner_id into v_minor_owner from public.faction_applications
    where faction_id=a.minor_fid and status='approved' order by updated_at desc limit 1;

  update public.state_annexations set status='accepted', sealed_at=now() where id=p_id;
  perform public._annex_merge(a.lead_fid, a.minor_fid, p_id);

  update public.faction_applications set status='annexed', updated_at=now()
    where faction_id=a.minor_fid and status='approved';

  begin
    update public.diplo_vassals set status='broken'
      where status in ('pending','active') and (vassal_fid=a.minor_fid or overlord_fid=a.minor_fid);
  exception when others then raise notice 'annex vassals: %', sqlerrm; end;
  begin
    update public.state_annexations set status='withdrawn'
      where status='pending' and (lead_fid=a.minor_fid or minor_fid=a.minor_fid);
  exception when others then raise notice 'annex pending: %', sqlerrm; end;

  if v_minor_owner is not null then
    begin
      update public.faction_members set status='left', updated_at=now()
        where user_id=v_minor_owner and status in ('active','pending');
      insert into public.faction_members(faction_id, user_id, status, role, perms,
                                         scope_all, note, decided_by)
        values (a.lead_fid, v_minor_owner, 'active', 'coruler', '[]'::jsonb, true,
                'Соправитель по акту объединения держав', v_minor_owner);
    exception when others then raise notice 'annex member: %', sqlerrm; end;
  end if;

  select name, color into v_lead_name, v_lead_color from public.faction_applications
    where faction_id=a.lead_fid and status='approved' limit 1;
  select name into v_minor_name from public.faction_applications
    where faction_id=a.minor_fid limit 1;
  perform public._annex_news(
    format('Провозглашена уния: «%s» и «%s»',
           coalesce(v_lead_name,a.lead_fid), coalesce(v_minor_name,a.minor_fid)),
    format('Две державы объявили о государственном объединении. Колонии, казна, войска и достижения '
        || 'науки «%s» и «%s» отныне общие, флаг «%s» сохранён над её прежними системами, '
        || 'а её правитель занял место соправителя при дворе.',
           coalesce(v_lead_name,a.lead_fid), coalesce(v_minor_name,a.minor_fid),
           coalesce(v_minor_name,a.minor_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.annex_respond(uuid,boolean) from public;
grant execute on function public.annex_respond(uuid,boolean) to authenticated;

-- ── RPC: расторгнуть унию ───────────────────────────────────
-- Право есть у обеих сторон: у владельца старшей — распустить, у бывшего
-- правителя младшей — уйти со своим. Возвращаем строго по реестру.
create or replace function public.annex_dissolve(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.state_annexations; v_uid uuid; v_own text;
        v_minor_owner uuid; v_lead_owner uuid;
        r record; snap jsonb; back_gc numeric; have_gc numeric;
        back_res jsonb; have_res jsonb; give_res jsonb; n_rows int := 0; t_rows int;
        v_lead_name text; v_minor_name text; v_lead_color text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_uid := auth.uid();
  if v_uid is null then raise exception 'forbidden'; end if;
  select * into a from public.state_annexations where id=p_id and status='accepted';
  if not found then raise exception 'уния не найдена'; end if;

  select owner_id into v_lead_owner from public.faction_applications
    where faction_id=a.lead_fid and status='approved' order by updated_at desc limit 1;
  select owner_id into v_minor_owner from public.faction_applications
    where faction_id=a.minor_fid and status='annexed' order by updated_at desc limit 1;
  if v_uid not in (coalesce(v_lead_owner,'00000000-0000-0000-0000-000000000000'::uuid),
                   coalesce(v_minor_owner,'00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'расторгнуть унию может только одна из её сторон';
  end if;
  -- Старшая должна быть жива: если её саму потом присоединили, разбирать
  -- надо сперва ту унию, иначе строки поедут в державу, которой уже нет.
  if not exists(select 1 from public.faction_applications
                 where faction_id=a.lead_fid and status='approved') then
    raise exception 'старшая держава сама вошла в чужой состав — расторгайте с той унии';
  end if;

  -- 1) Строки по реестру — обратно младшей. Нажитое после слияния в реестр
  --    не попало и остаётся старшей.
  for r in select distinct tbl, pk_col from public.annex_origin where annex_id=p_id loop
    begin
      execute format(
        'update public.%I s set faction_id = o.prev_fid
           from public.annex_origin o
          where o.annex_id = $1 and o.tbl = $2 and s.%I::text = o.pk_val
            and s.faction_id = $3',
        r.tbl, r.pk_col) using p_id, r.tbl, a.lead_fid;
      get diagnostics t_rows = row_count;
      n_rows := n_rows + coalesce(t_rows,0);
    exception when others then raise notice 'undo % : %', r.tbl, sqlerrm; end;
  end loop;

  -- 2) Территория — по union_origin
  begin
    update public.map_systems set faction = union_origin, union_origin = null
      where union_origin = a.minor_fid and faction = a.lead_fid;
  exception when others then raise notice 'undo systems: %', sqlerrm; end;

  -- 2б) Недвижимое следует за землёй. Иначе после возврата систем у старшей
  --     остались бы колонии, батареи и минные поля ВНУТРИ чужих границ —
  --     состояние, которого правила мира не предусматривают. Мобильное
  --     (флоты, МЗА, носители аванпостов) остаётся у хозяина: оно улетит само.
  for r in select unnest(array['colonies','colony_projects','doom_guns','econ_relief',
                              'guardian_posts','outposts','system_drone_posts',
                              'system_minefields','faction_intel_guard']) tbl loop
    begin
      execute format(
        'update public.%I s set faction_id = $1
          where s.faction_id = $2 and s.system_id in (
            select id from public.map_systems where faction = $1)', r.tbl)
        using a.minor_fid, a.lead_fid;
    exception when others then raise notice 'undo land % : %', r.tbl, sqlerrm; end;
  end loop;
  -- Постройки висят не на системе, а на колонии — идут за своей колонией.
  begin
    update public.colony_buildings b set faction_id = a.minor_fid
      from public.colonies c
     where c.id = b.colony_id and c.faction_id = a.minor_fid
       and b.faction_id = a.lead_fid;
  exception when others then raise notice 'undo buildings: %', sqlerrm; end;

  -- 3) Казна и ресурсы — по снимку, но не больше, чем есть у старшей.
  --    Технологии остаются у обеих: разучить знание нельзя.
  --    Снимка нет только у уний СТАРОГО образца, перенесённых миграцией:
  --    там казна младшей и так осталась лежать на своей строке, и трогать
  --    балансы нельзя — вычитание из старшей отняло бы у неё чужое.
  snap := a.minor_snapshot;
  if snap is null then
    raise notice 'undo economy: снимка нет (уния старого образца) — балансы не трогаем';
  else
  begin
    select coalesce(gc,0), coalesce(resources,'{}'::jsonb) into have_gc, have_res
      from public.faction_economy where faction_id = a.lead_fid;
    back_gc := least(coalesce((snap->>'gc')::numeric, 0), coalesce(have_gc,0));
    back_res := coalesce(snap->'resources', '{}'::jsonb);
    -- по каждому ресурсу отдаём min(снимок, наличие)
    select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb) into give_res from (
      select b.key k, least(b.value::numeric, coalesce((have_res->>b.key)::numeric, 0)) v
      from jsonb_each_text(back_res) b
    ) s where v > 0;

    update public.faction_economy set
      gc = greatest(coalesce(gc,0) - back_gc, 0),
      resources = (
        select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb) from (
          select key k, greatest(value::numeric - coalesce((give_res->>key)::numeric,0), 0) v
          from jsonb_each_text(coalesce(resources,'{}'::jsonb))
        ) s
      )
    where faction_id = a.lead_fid;

    update public.faction_economy set gc = back_gc, resources = give_res,
      research = coalesce(snap->'research', research)
      where faction_id = a.minor_fid;
  exception when others then raise notice 'undo economy: %', sqlerrm; end;
  end if;

  -- 4) Младшая снова держава, её правитель снова сам себе владелец
  update public.faction_applications set status='approved', updated_at=now()
    where faction_id=a.minor_fid and status='annexed';
  if v_minor_owner is not null then
    begin
      update public.faction_members set status='left', updated_at=now()
        where user_id=v_minor_owner and faction_id=a.lead_fid and status='active';
    exception when others then raise notice 'undo member: %', sqlerrm; end;
  end if;

  update public.state_annexations set status='dissolved' where id=p_id;
  delete from public.annex_origin where annex_id=p_id;

  select name, color into v_lead_name, v_lead_color from public.faction_applications
    where faction_id=a.lead_fid and status='approved' limit 1;
  select name into v_minor_name from public.faction_applications
    where faction_id=a.minor_fid limit 1;
  perform public._annex_news(
    format('Уния расторгнута: «%s» вновь суверенна', coalesce(v_minor_name,a.minor_fid)),
    format('Государственное объединение «%s» и «%s» распалось. «%s» вернула себе колонии, войска и казну, '
        || 'с которыми входила в унию; нажитое сообща осталось за «%s». Технологии, добытые вместе, '
        || 'остались у обеих держав — знание не отбирают обратно.',
           coalesce(v_lead_name,a.lead_fid), coalesce(v_minor_name,a.minor_fid),
           coalesce(v_minor_name,a.minor_fid), coalesce(v_lead_name,a.lead_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true,'rows',n_rows);
end$$;
revoke all on function public.annex_dissolve(uuid) from public;
grant execute on function public.annex_dissolve(uuid) to authenticated;

-- Статус 'dissolved' в CHECK исходной таблицы не был предусмотрен.
alter table public.state_annexations drop constraint if exists state_annexations_status_check;
alter table public.state_annexations add constraint state_annexations_status_check
  check (status in ('pending','accepted','declined','withdrawn','dissolved'));

-- ── diplo_status: показываем и действующие унии, а не только заявки ──
create or replace function public.diplo_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; v_uid uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select m.union_id into v_uid from public.diplo_members m where m.fid=v_fid limit 1;
  return jsonb_build_object(
    'union', (select to_jsonb(u) from public.diplo_unions u where u.id=v_uid),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('fid',m.fid,'name',public._fac_name(m.fid)) order by m.joined_at), '[]'::jsonb)
                from public.diplo_members m where m.union_id=v_uid),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'union_id',i.union_id,
                  'kind',(select kind from public.diplo_unions where id=i.union_id),
                  'name',(select name from public.diplo_unions where id=i.union_id),
                  'leader',public._fac_name((select leader_fid from public.diplo_unions where id=i.union_id))) order by i.created_at desc), '[]'::jsonb)
                from public.diplo_invites i where i.fid=v_fid and i.status='pending'),
    'vassals', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'overlord',d.overlord_fid,'overlord_name',public._fac_name(d.overlord_fid),
                  'vassal',d.vassal_fid,'vassal_name',public._fac_name(d.vassal_fid),'tribute_pct',d.tribute_pct,'status',d.status) order by d.created_at desc), '[]'::jsonb)
                from public.diplo_vassals d where (d.overlord_fid=v_fid or d.vassal_fid=v_fid) and d.status in ('pending','active')),
    -- Заявки на объединение: адресат ещё сам себе держава, ищем по своему fid.
    'annex', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,
                  'lead',a.lead_fid,'lead_name',public._fac_name(a.lead_fid),
                  'minor',a.minor_fid,'minor_name',public._fac_name(a.minor_fid),
                  'status',a.status) order by a.created_at desc), '[]'::jsonb)
                from public.state_annexations a
                where (a.lead_fid=v_fid or a.minor_fid=v_fid) and a.status='pending'),
    -- Действующие унии: после слияния ОБА игрока резолвятся в fid старшей,
    -- поэтому ищем по lead_fid — карточку видят и владелец, и соправитель.
    'annex_active', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,
                  'lead',a.lead_fid,'lead_name',public._fac_name(a.lead_fid),
                  'minor',a.minor_fid,
                  'minor_name',(select name from public.faction_applications
                                 where faction_id=a.minor_fid order by updated_at desc limit 1),
                  'sealed_at',a.sealed_at,
                  'restorable',(select count(*) from public.annex_origin o where o.annex_id=a.id)
                  ) order by a.sealed_at desc), '[]'::jsonb)
                from public.state_annexations a
                where a.lead_fid=v_fid and a.status='accepted'));
end$$;
revoke all on function public.diplo_status() from public;
grant execute on function public.diplo_status() to authenticated;

-- ============================================================
-- МИГРАЦИЯ ДЕЙСТВУЮЩИХ УНИЙ СТАРОГО ОБРАЗЦА
-- Активы у них давно слиты (тем же обобщённым проходом), но игрок-партнёр
-- держался в игре только на подмене _ec_my_fid через _su_lead_of: прав у
-- него не было НИКАКИХ, состав державы его не видел, и снять с него уния
-- ничего не могла. Переводим такие унии в новую модель:
--   • партнёр садится соправителем в faction_members — те же полномочия,
--     но теперь их видно и можно урезать;
--   • его анкета уходит в 'annexed', и личность резолвится штатно
--     (_fm_own_fid → null, _fm_member_fid → лидер), без подмены fid;
--   • сама уния помечается перенесённой, а в state_annexations появляется
--     действующая запись — значит её видно в интерфейсе и можно расторгнуть.
-- Реестра происхождения у них нет и быть не может: никто не записывал,
-- какая строка чья. Расторжение вернёт территорию по union_origin и всё
-- недвижимое на ней, но не тронет казну — об этом честно пишет интерфейс.
-- ============================================================
do $$
declare u record; v_owner uuid; v_new uuid;
begin
  for u in select * from public.state_unions where status='active' loop
    if not exists(select 1 from public.faction_applications
                   where faction_id=u.lead_fid and status='approved') then
      raise notice 'миграция унии %: ведущая держава не одобрена, пропуск', u.id;
      continue;
    end if;
    select owner_id into v_owner from public.faction_applications
      where faction_id=u.partner_fid and status='approved'
      order by updated_at desc limit 1;

    insert into public.state_annexations(lead_fid, minor_fid, status, created_at, sealed_at)
      values (u.lead_fid, u.partner_fid, 'accepted',
              coalesce(u.created_at, now()), coalesce(u.sealed_at, now()))
      returning id into v_new;

    update public.faction_applications set status='annexed', updated_at=now()
      where faction_id=u.partner_fid and status='approved';

    if v_owner is not null then
      update public.faction_members set status='left', updated_at=now()
        where user_id=v_owner and status in ('active','pending');
      insert into public.faction_members(faction_id, user_id, status, role, perms,
                                         scope_all, note, decided_by)
        values (u.lead_fid, v_owner, 'active', 'coruler', '[]'::jsonb, true,
                'Соправитель по унии, заключённой до реформы состава державы', v_owner);
    end if;

    update public.state_unions set status='dissolved' where id=u.id;
    raise notice 'уния % → объединение %: партнёр % стал соправителем', u.id, v_new, u.partner_fid;
  end loop;
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- annex_propose('<fid>') → annex_respond(id,true) → annex_dissolve(id)
