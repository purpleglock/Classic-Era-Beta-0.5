-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 7: ВЕНДЕТТА — ОТВЕТ НА НАГЛОСТЬ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_faction.sql, _legion_contacts.sql, _legion_tick.sql,
-- _legion_engage.sql, _legion_brief.sql и после артиллерии
-- (_interstellar_artillery.sql → _doom_shells.sql: doom_salvos). Идемпотентно.
--
-- ЗАЧЕМ. До этого шага Легион был односторонним: он ходил к игроку, игрок мог
-- бить его чем угодно — вплоть до залпа Длани по системе, где стоит ватага, —
-- и ЕДИНСТВЕННЫМ следствием была капля аггро (strength/4 из losses_sweep),
-- которая растворялась в общей формуле выбора цели. Наглость не отличалась от
-- фонового богатства: снести Легиону угодья гиперпейсером стоило ровно
-- столько же внимания, сколько «иметь жирную колонию».
--
-- ЗАМЫСЕЛ. Обида теперь ИМЕННАЯ и с адресом:
--   • ПРОВОКАЦИЯ (legion_grudges) — строка с ценой, местом и причиной. Пишется
--     из боя (разбитая ватага) и из артиллерии (залп лёг туда, где у Легиона
--     дело). Не «злость вообще», а список, по которому будут отвечать.
--   • КАРАТЕЛЬНЫЙ ОТРЯД (contacts.reprisal) — отдельный контакт, который НЕ
--     ждёт накопления секторальной копилки. Обычная кампания копит месяцами и
--     потому не может ответить на удар в течение суток; вендетта оплачивается
--     самой обидой. Отсюда правило, ради которого всё и затевалось: масштаб
--     ответа = масштаб наглости, а не богатство сектора.
--   • ЛЕНТА. Каждая провокация и каждый карательный отряд идут И в личные
--     депеши обидчику, И в общую ленту: расправа над обидчиком Легиона должна
--     быть публичной, иначе она никого ничему не учит.
--
-- ⚠ ПОЧЕМУ ОТВЕТ ОГРАНИЧЕН ДОЛГОМ. Соблазн был сделать «Легион приходит всей
-- мощью». Это ломает вещь, ради которой давление вообще существует: игрок
-- перестаёт понимать цену действия. Здесь strength = 16 + долг×1.5 с потолком
-- 72 — по одному отряду за раз на державу и не чаще, чем раз в два часа.
-- Ударил разок — придёт заметная ватага; расстрелял угодья Дланью трижды —
-- придёт то, чем сектор не набирает и за месяц.
-- ════════════════════════════════════════════════════════════

-- ── 1. РЕЕСТР ОБИД ──────────────────────────────────────────
-- src_id — ключ источника (id залпа, id контакта). Уникален там, где не null:
-- один и тот же залп не должен породить две обиды при повторном скане.
create table if not exists public.legion_grudges (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  at          timestamptz not null default now(),
  sys         text,
  sector_id   uuid,
  kind        text not null default 'other',   -- salvo | fleet_killed | other
  weight      numeric not null default 0,
  reason      text,
  src_id      uuid,
  answered_at timestamptz,
  contact_id  uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists legion_grudges_src_idx
  on public.legion_grudges(src_id) where src_id is not null;
create index if not exists legion_grudges_open_idx
  on public.legion_grudges(faction_id) where answered_at is null;
-- Кухня ИИ: наружу обида уходит только через legion_brief() (шаг 6).
alter table public.legion_grudges enable row level security;

-- Карательный отряд — тот же контакт, но помеченный: его видно в сводке и по
-- нему считается «одна вендетта в воздухе на державу».
alter table public.legion_contacts
  add column if not exists reprisal boolean not null default false;

-- ── 2. ГЛАСНОСТЬ ────────────────────────────────────────────
-- Личная депеша уже есть (_legion_news из шага 4). Здесь — общая лента: цвет
-- Легиона, а не тревожно-красный артиллерии, чтобы в ленте эти события читались
-- как один сюжет.
create or replace function public._legion_feed(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public._post_sector_news(p_title, p_body, 'rgba(196,74,42,0.55)');
  exception when others then null;   -- лента не критична для механики
  end;
end$$;
revoke all on function public._legion_feed(text,text) from public;

-- ── 3. ПРОВОКАЦИЯ ───────────────────────────────────────────
-- Единственная дверь: и бой, и артиллерия, и всё, что появится потом, зовут
-- ЭТО, а не пишут аггро руками. Иначе «за что» опять расползётся по файлам.
create or replace function public._legion_provoke(
  p_fid text, p_sys text, p_kind text, p_weight numeric,
  p_reason text, p_src uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid; sname text; fname text; sec uuid;
begin
  if p_fid is null or p_fid = public._legion_fid() or coalesce(p_weight,0) <= 0 then
    return null;
  end if;
  -- повтор по тому же источнику молча гасим: скан прошлого не должен
  -- пересчитывать уже записанные обиды
  if p_src is not null and exists (select 1 from public.legion_grudges where src_id = p_src) then
    return null;
  end if;

  sec := case when p_sys is null then null else public._legion_sector_of(p_sys) end;
  insert into public.legion_grudges(faction_id, sys, sector_id, kind, weight, reason, src_id)
    values (p_fid, p_sys, sec, coalesce(p_kind,'other'), p_weight, p_reason, p_src)
    returning id into gid;

  -- аггро остаётся общей памятью (полураспад ~7 суток) и по-прежнему двигает
  -- выбор цели в обычной кампании; вендетта — отдельный, быстрый слой поверх
  perform public._legion_aggro_add(p_fid, p_weight, p_reason);

  select name into sname from public.map_systems where id = p_sys;
  select name into fname from public.faction_applications
    where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;

  perform public._legion_news(p_fid, '☠ Легион запомнил',
    format('%s. Железный Легион не держава и не судится: счёт он предъявляет карательным отрядом. Ждите гостей.',
           coalesce(p_reason, 'Наши действия задели интересы Легиона')));

  -- в общую ленту — только заметная наглость, иначе лента превратится в шум
  if p_weight >= 6 then
    perform public._legion_feed('☠ ЖЕЛЕЗНЫЙ ЛЕГИОН ПРИНЯЛ ВЫЗОВ',
      format('%s%s. %s Пиратские капитаны Легиона объявили счёт открытым — карательный отряд собирается.',
        coalesce(fname, 'Неизвестная держава'),
        case when sname is not null then ' — система «' || sname || '»' else '' end,
        coalesce(p_reason || '.', '')));
  end if;
  return gid;
end$$;
revoke all on function public._legion_provoke(text,text,text,numeric,text,uuid) from public;

-- ── 4. ЧТО У ЛЕГИОНА ЕСТЬ В СИСТЕМЕ ─────────────────────────
-- Вес интереса: по нему решается, наглость это или залп в пустоту. Ватага на
-- месте весит больше всего — по ней стреляли прицельно; трасса подхода весит
-- мало — там Легион просто проходил.
create or replace function public._legion_interest(p_sys text, p_at timestamptz default now())
-- ⚠ least/greatest в Postgres ИГНОРИРУЮТ null: least(8.0, null) = 8.0. Первая
-- редакция считала корабли ватаги как `least(8.0, sum(...))` без строки — и на
-- пустой системе возвращала 10+8=18, то есть НАГЛОСТЬЮ становился любой залп по
-- любой планете галактики. Поэтому счёт кораблей вынесен отдельной строкой и
-- ветка включается только при q > 0.
returns numeric language sql stable security definer set search_path=public as $$
  with n as (
    select coalesce((select sum(greatest(0,(c->>'qty')::int))
                       from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
                      where f.system_id = p_sys and f.faction_id = public._legion_fid()), 0) q
  )
  select
    -- стоящая ватага: прицельный залп по кораблям Легиона
    (select case when n.q > 0 then 10.0 + least(8.0, n.q * 0.5) else 0 end from n)
    -- отряд шёл именно сюда или отсюда вышел: угодья
  + coalesce((select 6.0 from public.legion_contacts k
               where (k.target_sys = p_sys or k.origin_sys = p_sys)
                 and k.state in ('inbound','landed','engaged')
                 and k.created_at > p_at - interval '3 days' limit 1), 0)
    -- трасса подхода: задело краем
  + coalesce((select 2.0 from public.legion_contacts k
               where k.state in ('inbound','landed','engaged')
                 and k.route ? p_sys
                 and k.created_at > p_at - interval '3 days' limit 1), 0)
$$;
revoke all on function public._legion_interest(text,timestamptz) from public;

-- ── 5. ЗАЛП ЛЁГ В УГОДЬЯ ЛЕГИОНА ────────────────────────────
-- Длань и гиперпейсер — самое наглое, что игрок может сделать: снаряд стирает
-- мир целиком, вместе со всем, что Легион вокруг него держал. Цена наглости
-- считается по калибру, а не по факту попадания: перехваченный залп — тоже
-- покушение, и Легион его засчитывает.
create or replace function public._legion_salvo_grudge(p_salvo uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare s public.doom_salvos; w numeric; iv numeric; sname text; kindname text; gid uuid;
begin
  select * into s from public.doom_salvos where id = p_salvo;
  if not found or s.faction_id is null then return 0; end if;

  iv := public._legion_interest(s.target_system_id, coalesce(s.resolved_at, s.ready_at, now()));
  if iv < 2 then return 0; end if;   -- в пустоту — Легиону всё равно

  kindname := case coalesce(s.kind,'doom')
                when 'doom' then 'залп Длани Неотвратимости'
                when 'ball_light' then 'лёгкий баллистический залп'
                when 'ball_emp' then 'залп снарядом-«Фантомом»'
                when 'ball_cluster' then 'кассетный залп'
                else 'тяжёлый баллистический залп' end;
  -- Длань = гибель мира: вдвое дороже любой баллистики
  w := iv * case when coalesce(s.kind,'doom') = 'doom' then 2.0 else 1.0 end;
  -- перехваченный залп злит слабее: намерение было, разрушения не было
  if s.status = 'intercepted' then w := w * 0.6; end if;

  select name into sname from public.map_systems where id = s.target_system_id;
  gid := public._legion_provoke(
    s.faction_id, s.target_system_id, 'salvo', round(w,2),
    format('%s по системе «%s», где стояло дело Легиона',
           kindname, coalesce(sname, s.target_system_id)),
    s.id);
  return case when gid is null then 0 else round(w,2) end;
end$$;
revoke all on function public._legion_salvo_grudge(uuid) from public;

-- Триггер: обиду считаем в момент РАЗРЕШЕНИЯ залпа, а не запуска — до этого
-- ватага ещё может уйти, и стрелявший не виноват в том, чего не случилось.
create or replace function public._legion_on_salvo()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('done','intercepted') and coalesce(old.status,'') is distinct from new.status then
    begin
      perform public._legion_salvo_grudge(new.id);
    exception when others then null;   -- реакция ИИ не должна ронять резолв залпа
    end;
  end if;
  return new;
end$$;
drop trigger if exists trg_legion_on_salvo on public.doom_salvos;
create trigger trg_legion_on_salvo after update of status on public.doom_salvos
  for each row execute function public._legion_on_salvo();

-- ── 6. РАЗБИТАЯ ВАТАГА — ТОЖЕ ОБИДА ─────────────────────────
-- Суперсет legion_losses_sweep из шага 4: тот же учёт потерь, но провокация
-- вместо голого аггро. Вес выше прежнего (strength/3 против strength/4) —
-- выбитый отряд это потраченный сектор-месяц, и молча это проглатывать
-- бессмысленно: именно ради ответа игрок и должен решать, драться ли.
create or replace function public.legion_losses_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; n int := 0;
begin
  for k in select c.* from public.legion_contacts c
            where c.state = 'engaged' and c.fleet_id is not null
              and not exists (select 1 from public.fleets f where f.id = c.fleet_id) loop
    perform public._legion_lost(k.sector_id, k.strength);
    perform public._legion_provoke(k.target_fid, k.target_sys, 'fleet_killed',
              round(k.strength / 3.0, 2),
              format('разбита ватага Легиона в системе %s', k.target_sys), k.id);
    update public.legion_contacts set state = 'spent' where id = k.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'lost', n);
end$$;
revoke all on function public.legion_losses_sweep() from public;

-- ── 7. КАРАТЕЛЬНЫЙ ОТРЯД ────────────────────────────────────
-- Порог и потолки в одном месте: балансировать вендетту придётся отдельно от
-- обычной кампании, и лазить за числами в тело функции не надо.
create or replace function public._legion_vend_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'debt_bite'  then 6      -- ниже этого Легион просто запоминает
    when 'base'       then 16     -- костяк отряда, даже за мелкую наглость
    when 'per_debt'   then 1.5    -- сколько силы даёт единица долга
    when 'cap'        then 72     -- потолок одного отряда
    when 'cooldown_h' then 2      -- не чаще, чем раз в два часа на державу
    else 0 end
$$;

create or replace function public.legion_vendetta_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v record; t record; debt numeric; str numeric; kid uuid; take numeric;
        sec uuid; sname text; fname text; made int := 0; log jsonb := '[]'::jsonb;
begin
  for v in select g.faction_id fid, sum(g.weight) debt, max(g.at) last_at
             from public.legion_grudges g
            where g.answered_at is null
            group by g.faction_id
           having sum(g.weight) >= public._legion_vend_const('debt_bite')
            order by 2 desc loop

    -- одна вендетта в воздухе на державу: Легион давит адресно, а не валом
    if exists (select 1 from public.legion_contacts k
                where k.reprisal and k.target_fid = v.fid and k.state = 'inbound') then
      continue;
    end if;
    -- выдержка: залп из трёх снарядов подряд не должен родить три отряда
    if exists (select 1 from public.legion_contacts k
                where k.reprisal and k.target_fid = v.fid
                  and k.depart_at > now() - (public._legion_vend_const('cooldown_h') || ' hours')::interval) then
      continue;
    end if;

    debt := v.debt;
    -- КУДА: та же формула, что и в обычном тике, но прогнанная только по добру
    -- обидчика (шаг 6). Значит, оборона по-прежнему в знаменателе: карательный
    -- отряд идёт не «в столицу», а туда, где у обидчика плохо лежит.
    select * into t from public._legion_my_targets(v.fid) limit 1;
    if t.sys is null then continue; end if;
    sec := public._legion_sector_of(t.sys);
    if sec is null then continue; end if;

    str := least(public._legion_vend_const('cap'),
                 public._legion_vend_const('base') + debt * public._legion_vend_const('per_debt'));

    -- Копилка сектора тратится, СКОЛЬКО ЕСТЬ, но отряд не отменяется: вендетта
    -- оплачена обидой, а не давлением. Списываем всё же честно — иначе сектор
    -- после расправы продолжал бы жить как ни в чём не бывало.
    select least(coalesce(lp.pressure,0), str) into take
      from public.legion_pressure lp where lp.sector_id = sec;
    if coalesce(take,0) > 0 then perform public._legion_spend(sec, take); end if;

    kid := public._legion_contact_spawn(sec, v.fid, t.sys, t.kind, str);
    if kid is null then continue; end if;
    update public.legion_contacts set reprisal = true where id = kid;

    update public.legion_grudges
       set answered_at = now(), contact_id = kid
     where faction_id = v.fid and answered_at is null;

    select name into sname from public.map_systems where id = t.sys;
    select name into fname from public.faction_applications
      where faction_id = v.fid and status = 'approved' order by updated_at desc limit 1;

    perform public._legion_news(v.fid, '☠ КАРАТЕЛЬНЫЙ ОТРЯД ЛЕГИОНА ВЫШЕЛ',
      format('Счёт закрыт не будет: Железный Легион снарядил карательный отряд и ведёт его к системе «%s». Замысел — %s, сила отряда — %s (это не рядовой налёт). Отряд оплачен нашими же выходками: чем наглее был удар, тем крупнее ватага.',
        coalesce(sname, t.sys),
        case t.kind when 'strike' then 'удар по колонии'
                    when 'blind'  then 'налёт на аванпост'
                    else 'разбой на трассе' end,
        to_char(str,'FM990.0')));

    perform public._legion_feed('☠ ЛЕГИОН ОТПРАВИЛ КАРАТЕЛЬНЫЙ ОТРЯД',
      format('Железный Легион ответил державе «%s» за налёт на свои угодья. К системе «%s» идёт ватага силой %s — крупнее всего, что Легион водит по обычным делам. У пиратов нет дипломатии: у них есть память и счёт.',
        coalesce(fname, '???'), coalesce(sname, t.sys), to_char(str,'FM990.0')));

    made := made + 1;
    log := log || jsonb_build_array(jsonb_build_object(
      'fid', v.fid, 'debt', round(debt,2), 'sys', t.sys, 'kind', t.kind, 'strength', round(str,2)));
  end loop;

  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'reprisals', made, 'log', log);
end$$;
revoke all on function public.legion_vendetta_tick() from public;

-- ── 8. КОНТАКТ: КАРАТЕЛЬНЫЙ ВИДЕН КАК КАРАТЕЛЬНЫЙ ───────────
-- Суперсет legion_contacts_visible из шага 2: добавлено одно поле. Метку даём
-- с той же ступени, что и состав (resolved): «за нами идут мстить» — это уже
-- вскрытый замысел, а не силуэт, и покупается он полным экипажем разведстанции.
create or replace function public.legion_contacts_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row order by row->>'eta' nulls last)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id',     g.contact_id,
        'grade',  g.grade,
        'sector', sec.name,
        'since',  g.first_seen,
        'seen',   g.last_seen,
        'sys',    case when public._legion_grade_rank(g.grade) >= 2 then g.last_sys end,
        'eta',    case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
        'band',   case when public._legion_grade_rank(g.grade) >= 2 then
                    case when k.strength >= 45 then 'крупная'
                         when k.strength >= 20 then 'заметная'
                         else 'слабая' end end,
        'target_sys', case when g.grade = 'resolved' then k.target_sys end,
        'mine',       case when g.grade = 'resolved' then (k.target_fid = fid) end,
        'kind',       case when g.grade = 'resolved' then k.kind end,
        'reprisal',   case when g.grade = 'resolved' and k.reprisal then true end,
        'ships',      case when g.grade = 'resolved'
                           then greatest(1, round(k.strength / 8.0))::int end
      )) as row
      from public.legion_sightings g
      join public.legion_contacts k on k.id = g.contact_id
      left join public.map_sectors sec on sec.id = g.last_sector
      where g.faction_id = fid and k.state = 'inbound'
    ) q
  ), '[]'::jsonb);
end$$;
revoke all on function public.legion_contacts_visible() from public;
grant execute on function public.legion_contacts_visible() to authenticated;

-- ── 9. СВОДКА: НАШ СЧЁТ ПЕРЕД ЛЕГИОНОМ ──────────────────────
-- Суперсет legion_brief из шага 6: добавлен блок vendetta. Правило прежнее —
-- наружу только своё: наши же выходки, их цена и то, оплачен ли счёт.
create or replace function public.legion_brief()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; res jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('fid', null); end if;

  select jsonb_build_object(
    'fid',  fid,
    'meta', public._legion_meta(),
    'aggro', (select jsonb_build_object(
                'v', round(a.aggro,2),
                'bite', public._legion_const('aggro_bite'),
                'reason', a.last_reason,
                'at', a.last_provoke)
                from public.legion_aggro a where a.faction_id = fid),
    'contacts', public.legion_contacts_visible(),
    'eyes', (select jsonb_build_object(
               'recon_full', count(*) filter (where o.mode='recon' and public._outpost_crew_k(o.crew,o.mode) >= 1.0),
               'recon_weak', count(*) filter (where o.mode='recon' and public._outpost_crew_k(o.crew,o.mode) <  1.0),
               'depot',      count(*) filter (where o.mode='depot'))
               from public.outposts o where o.faction_id = fid),

    -- ☠ ВЕНДЕТТА: неоплаченный счёт, порог ответа и наши выходки за 14 суток.
    -- Долг показываем сырым числом рядом с порогом: игрок должен видеть, что
    -- ответ не «когда-нибудь», а ровно после порога.
    'vendetta', jsonb_build_object(
      'debt', coalesce((select round(sum(g.weight),2) from public.legion_grudges g
                         where g.faction_id = fid and g.answered_at is null), 0),
      'bite', public._legion_vend_const('debt_bite'),
      'inbound', (select count(*) from public.legion_contacts k
                   where k.reprisal and k.target_fid = fid and k.state = 'inbound'),
      'acts', coalesce((select jsonb_agg(jsonb_build_object(
                'at', h.at, 'kind', h.kind, 'weight', round(h.weight,2),
                'reason', h.reason, 'sys', h.sys,
                'name', coalesce(gms.name, h.sys),
                'answered', (h.answered_at is not null))
                order by h.at desc)
                from (select * from public.legion_grudges g
                       where g.faction_id = fid and g.at > now() - interval '14 days'
                       order by g.at desc limit 30) h
                left join public.map_systems gms on gms.id = h.sys), '[]'::jsonb)),

    'here', coalesce((select jsonb_agg(jsonb_build_object(
              'fleet', f.id, 'sys', f.system_id,
              'ships', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                          from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)))
              from public.fleets f
             where f.faction_id = public._legion_fid()
               and (exists (select 1 from public.colonies c where c.system_id = f.system_id and c.faction_id = fid)
                 or exists (select 1 from public.outposts o where o.system_id = f.system_id and o.faction_id = fid))
            ), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
                 'sys', q.sys, 'name', coalesce(ms.name, q.sys),
                 'sector', sec.name,
                 'kind', q.kind, 'value', q.value, 'guard', q.guard, 'score', q.score)
                 order by q.score desc)
                 from (select * from public._legion_my_targets(fid)
                        order by score desc limit 40) q
                 left join public.map_systems ms on ms.id = q.sys
                 left join public.map_sectors sec on q.sys = any(sec.system_ids)
               ), '[]'::jsonb),
    'targets_total', (select count(*) from public._legion_my_targets(fid)),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', h.kind, 'sys', h.target_sys,
                 'name', coalesce(hms.name, h.target_sys),
                 'at', h.arrive_at, 'state', h.state,
                 'reprisal', h.reprisal)
                 order by h.arrive_at desc)
                 from (select * from public.legion_contacts c
                        where c.target_fid = fid and c.state <> 'inbound'
                          and c.arrive_at > now() - interval '30 days'
                        order by c.arrive_at desc limit 40) h
                 left join public.map_systems hms on hms.id = h.target_sys
               ), '[]'::jsonb)
  ) into res;

  return res;
end$$;
revoke all on function public.legion_brief() from public;
grant execute on function public.legion_brief() to authenticated;

-- ── 10. ЦИКЛ ────────────────────────────────────────────────
-- Каждые 15 минут, между сканом контактов и приземлением: обида, записанная
-- триггером залпа, должна превращаться в отряд в тот же день, а не через сутки.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-vendetta-tick')
      where exists (select 1 from cron.job where jobname = 'legion-vendetta-tick');
    perform cron.schedule('legion-vendetta-tick', '5,20,35,50 * * * *',
                          'select public.legion_vendetta_tick();');
  end if;
end$$;

-- ── 11. ЗАДНИМ ЧИСЛОМ: ЗАЛПЫ, КОТОРЫЕ УЖЕ ПРОШЛИ ────────────
-- Триггер ловит будущее. Всё, чем по Легиону успели отстреляться ДО наката,
-- иначе осталось бы безнаказанным — а именно из-за такого выстрела шаг и
-- писался. Проходим неделю; src_id не даёт посчитать залп дважды.
do $$
declare r record; n int := 0;
begin
  for r in select id from public.doom_salvos
            where status in ('done','intercepted')
              and coalesce(resolved_at, ready_at) > now() - interval '7 days'
            order by coalesce(resolved_at, ready_at) loop
    begin
      if coalesce(public._legion_salvo_grudge(r.id),0) > 0 then n := n + 1; end if;
    exception when others then null;
    end;
  end loop;
  raise notice 'legion vendetta backfill: % провокаций записано', n;
end$$;

-- И сразу ответ: если счёт уже перевалил порог, карательный отряд выходит
-- не дожидаясь ближайшего крона.
select public.legion_vendetta_tick();
