-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 7б: ЛОГОВО — УДАР ПО РОДОВОМУ ГНЕЗДУ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_vendetta.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. _legion_interest считала интересом Легиона только ватаги и
-- контакты — то есть ТО, ЧТО ДВИЖЕТСЯ. Но у Легиона есть и неподвижное: он
-- берёт корпуса у Железного Дивизиона (_legion_meta()->>'hull_fid'), и системы
-- Дивизиона — это верфи, из которых он собирает каждый свой отряд. Залп Длани
-- по «Железной Столице» в Вето-Прайм проходил мимо реестра обид вовсе: формально
-- в системе не стояло ни одной ватаги, значит «в пустоту». Логово оказалось
-- единственным местом, куда игрок мог бить БЕЗНАКАЗАННО, — ровно наоборот тому,
-- как это должно читаться.
--
-- ДВА ИСПРАВЛЕНИЯ.
--   1) ЛОГОВО в интересе: система с колониями Дивизиона весит как ватага и
--      больше — по населению. Столица (самая крупная колония) даёт максимум.
--   2) ОБИДА НА ЗАПУСК, а не только на попадание. Для рядовой системы ждать
--      разрешения залпа правильно (ватага может уйти, стрелявший не виноват в
--      том, чего не случилось). Но логово никуда не улетит: снаряд, вышедший в
--      сторону родового гнезда, — уже покушение, и Легион поднимается по
--      подлётному времени, а не по факту пепелища. Иначе единственный сценарий,
--      ради которого всё писалось, отвечал бы через сутки после того, как
--      столицы уже нет.
-- Вес запуска — половина: попадание досчитается отдельной строкой.
-- ════════════════════════════════════════════════════════════

-- ── 1. Один залп — две обиды (покушение и попадание) ────────
-- Уникальность переезжает с src_id на пару (src_id, kind): иначе строка
-- «залп вышел» съедала бы место у строки «залп лёг».
drop index if exists public.legion_grudges_src_idx;
create unique index if not exists legion_grudges_src_kind_idx
  on public.legion_grudges(src_id, kind) where src_id is not null;

create or replace function public._legion_provoke(
  p_fid text, p_sys text, p_kind text, p_weight numeric,
  p_reason text, p_src uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid; sname text; fname text; sec uuid;
begin
  if p_fid is null or p_fid = public._legion_fid() or coalesce(p_weight,0) <= 0 then
    return null;
  end if;
  if p_src is not null and exists (select 1 from public.legion_grudges
                                    where src_id = p_src and kind = coalesce(p_kind,'other')) then
    return null;
  end if;

  sec := case when p_sys is null then null else public._legion_sector_of(p_sys) end;
  insert into public.legion_grudges(faction_id, sys, sector_id, kind, weight, reason, src_id)
    values (p_fid, p_sys, sec, coalesce(p_kind,'other'), p_weight, p_reason, p_src)
    returning id into gid;

  perform public._legion_aggro_add(p_fid, p_weight, p_reason);

  select name into sname from public.map_systems where id = p_sys;
  select name into fname from public.faction_applications
    where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;

  perform public._legion_news(p_fid, '☠ Легион запомнил',
    format('%s. Железный Легион не держава и не судится: счёт он предъявляет карательным отрядом. Ждите гостей.',
           coalesce(p_reason, 'Наши действия задели интересы Легиона')));

  if p_weight >= 6 then
    perform public._legion_feed('☠ ЖЕЛЕЗНЫЙ ЛЕГИОН ПРИНЯЛ ВЫЗОВ',
      format('%s%s. %s Пиратские капитаны Легиона объявили счёт открытым — карательный отряд собирается.',
        coalesce(fname, 'Неизвестная держава'),
        case when sname is not null then ' — система «' || sname || '»' else '' end,
        -- причина приходит фразой со строчной буквы («снаряд выпущен по…»):
        -- в ленте она стоит после точки и должна начинаться с прописной
        coalesce(upper(left(p_reason,1)) || substr(p_reason,2) || '.', '')));
  end if;
  return gid;
end$$;
revoke all on function public._legion_provoke(text,text,text,numeric,text,uuid) from public;

-- ── 2. ИНТЕРЕС: логово весит больше движущегося ─────────────
-- Порядок весов намеренный: ЛОГОВО (12…20) > ВАТАГА (10…18) > угодья (6) >
-- трасса (2). Разбить отряд — дело житейское, отряд для того и посылают. Стрелять
-- по верфям, из которых этот отряд собран, — другое, и цена должна отличаться
-- не оттенком, а порядком.
create or replace function public._legion_interest(p_sys text, p_at timestamptz default now())
returns numeric language sql stable security definer set search_path=public as $$
  with n as (
    select coalesce((select sum(greatest(0,(c->>'qty')::int))
                       from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
                      where f.system_id = p_sys and f.faction_id = public._legion_fid()), 0) q
  ), lair as (
    -- колонии Железного Дивизиона: верфи, из которых Легион берёт корпуса
    select coalesce(count(*),0) k, coalesce(max(coalesce(c.pop,0)),0) top
      from public.colonies c
     where c.system_id = p_sys
       and c.faction_id = (public._legion_meta()->>'hull_fid')
  )
  select
    (select case when l.k > 0 then 12.0 + least(8.0, l.k * 0.5 + l.top / 300.0) else 0 end from lair l)
  + (select case when n.q > 0 then 10.0 + least(8.0, n.q * 0.5) else 0 end from n)
  + coalesce((select 6.0 from public.legion_contacts k
               where (k.target_sys = p_sys or k.origin_sys = p_sys)
                 and k.state in ('inbound','landed','engaged')
                 and k.created_at > p_at - interval '3 days' limit 1), 0)
  + coalesce((select 2.0 from public.legion_contacts k
               where k.state in ('inbound','landed','engaged')
                 and k.route ? p_sys
                 and k.created_at > p_at - interval '3 days' limit 1), 0)
$$;
revoke all on function public._legion_interest(text,timestamptz) from public;

-- Есть ли в системе логово: отдельной функцией, потому что от этого зависит не
-- вес, а САМ МОМЕНТ реакции (запуск против попадания).
create or replace function public._legion_is_lair(p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.colonies c
                  where c.system_id = p_sys
                    and c.faction_id = (public._legion_meta()->>'hull_fid'))
$$;
revoke all on function public._legion_is_lair(text) from public;

-- ── 3. ПОКУШЕНИЕ: снаряд вышел в сторону логова ─────────────
create or replace function public._legion_salvo_launch_grudge(p_salvo uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare s public.doom_salvos; w numeric; iv numeric; sname text; gid uuid;
begin
  select * into s from public.doom_salvos where id = p_salvo;
  if not found or s.faction_id is null then return 0; end if;
  if not public._legion_is_lair(s.target_system_id) then return 0; end if;

  iv := public._legion_interest(s.target_system_id, now());
  w  := iv * 0.5 * case when coalesce(s.kind,'doom') = 'doom' then 2.0 else 1.0 end;
  select name into sname from public.map_systems where id = s.target_system_id;

  gid := public._legion_provoke(
    s.faction_id, s.target_system_id, 'salvo_launch', round(w,2),
    format('снаряд выпущен по «%s» в системе «%s» — родовое гнездо Легиона',
           coalesce(s.target_planet,'планете'), coalesce(sname, s.target_system_id)),
    s.id);
  if gid is null then return 0; end if;

  -- логово — единственный случай, когда Легион кричит в общую ленту ДО удара:
  -- подлётное время здесь и есть его фора
  perform public._legion_feed('☠ СНАРЯД ИДЁТ НА ЛОГОВО ЛЕГИОНА',
    format('По системе «%s» выпущен %s: цель — «%s», верфи, из которых Железный Легион собирает каждую свою ватагу. Пираты подняли всё, что стоит на ходу. Ответ не будет дожидаться воронки.',
      coalesce(sname, s.target_system_id),
      case when coalesce(s.kind,'doom') = 'doom' then 'залп Длани Неотвратимости' else 'баллистический снаряд' end,
      coalesce(s.target_planet,'планета')));
  return round(w,2);
end$$;
revoke all on function public._legion_salvo_launch_grudge(uuid) from public;

-- ⚠ ОТРЯД ВЫХОДИТ В ТОТ ЖЕ МИГ, а не по ближайшему крону. Пятнадцатиминутная
-- пауза между выстрелом и сбором ватаги читается игроком ровно как «реакции
-- нет»: депеши уже висят в ленте, а на карте пусто. Для залпа по логову это
-- недопустимо — весь смысл ветки в том, что Легион поднимается по ПОДЛЁТНОМУ
-- времени. Тик обёрнут в тот же перехват: он прокладывает маршрут (Дейкстра на
-- один путь), и если это почему-то не удалось, залп игрока всё равно должен
-- пройти — вендетта тогда доедет ближайшим кроном.
create or replace function public._legion_on_salvo_new()
returns trigger language plpgsql security definer set search_path=public as $$
declare w numeric;
begin
  begin
    w := public._legion_salvo_launch_grudge(new.id);
    if coalesce(w,0) > 0 then perform public.legion_vendetta_tick(); end if;
  exception when others then null;   -- реакция ИИ не должна ронять сам залп
  end;
  return new;
end$$;
drop trigger if exists trg_legion_on_salvo_new on public.doom_salvos;
create trigger trg_legion_on_salvo_new after insert on public.doom_salvos
  for each row execute function public._legion_on_salvo_new();

-- ── 4. ПОПАДАНИЕ: та же функция, но логово называем логовом ──
create or replace function public._legion_salvo_grudge(p_salvo uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare s public.doom_salvos; w numeric; iv numeric; sname text; kindname text; gid uuid; lair boolean;
begin
  select * into s from public.doom_salvos where id = p_salvo;
  if not found or s.faction_id is null then return 0; end if;

  iv := public._legion_interest(s.target_system_id, coalesce(s.resolved_at, s.ready_at, now()));
  if iv < 2 then return 0; end if;

  lair := public._legion_is_lair(s.target_system_id);
  kindname := case coalesce(s.kind,'doom')
                when 'doom' then 'залп Длани Неотвратимости'
                when 'ball_light' then 'лёгкий баллистический залп'
                when 'ball_emp' then 'залп снарядом-«Фантомом»'
                when 'ball_cluster' then 'кассетный залп'
                else 'тяжёлый баллистический залп' end;
  w := iv * case when coalesce(s.kind,'doom') = 'doom' then 2.0 else 1.0 end;
  if s.status = 'intercepted' then w := w * 0.6; end if;

  select name into sname from public.map_systems where id = s.target_system_id;
  gid := public._legion_provoke(
    s.faction_id, s.target_system_id, 'salvo', round(w,2),
    format('%s по системе «%s» — %s', kindname, coalesce(sname, s.target_system_id),
           case when lair then 'выжжено логово Легиона' else 'там стояло дело Легиона' end),
    s.id);
  return case when gid is null then 0 else round(w,2) end;
end$$;
revoke all on function public._legion_salvo_grudge(uuid) from public;

-- ── 5. ЗАДНИМ ЧИСЛОМ: залпы по логову ───────────────────────
-- Летящие сейчас снаряды — покушение (триггер INSERT их не застал), уже
-- разрешённые за 7 суток — попадание. Пара (src_id, kind) не даст задвоить.
do $$
declare r record; n int := 0;
begin
  for r in select id from public.doom_salvos where status = 'in_flight' loop
    begin
      if coalesce(public._legion_salvo_launch_grudge(r.id),0) > 0 then n := n + 1; end if;
    exception when others then null;
    end;
  end loop;
  for r in select id from public.doom_salvos
            where status in ('done','intercepted')
              and coalesce(resolved_at, ready_at) > now() - interval '7 days' loop
    begin
      if coalesce(public._legion_salvo_grudge(r.id),0) > 0 then n := n + 1; end if;
    exception when others then null;
    end;
  end loop;
  raise notice 'legion lair backfill: % провокаций', n;
end$$;

select public.legion_vendetta_tick();
