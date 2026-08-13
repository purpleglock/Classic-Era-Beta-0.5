-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 4: ПРИЗЕМЛЕНИЕ — БОЙ, РЕЙД, ВЫБИВАНИЕ ЗАСТАВ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_tick.sql, _slavery.sql (_slaves_add, образец налёта),
-- _army_fleet.sql (fleets), _pirate_fleet.sql (корпуса). Идемпотентно.
--
-- ЗАМЫСЕЛ. Контакт долетел — дальше три исхода, и выбирает их не бросок, а
-- обстановка в системе:
--   • ВСТРЕТИЛИ (в системе стоит чужой флот) → Легион МАТЕРИАЛИЗУЕТСЯ: в системе
--     появляется настоящий флот на fid 'legion'. Дальше работает уже
--     существующая машинерия боёв и _bot_ai_brain — игрок бьёт его теми же
--     кнопками, что и любого врага.
--     ⚠ Намеренно НЕ фабрикуем строку battles из крона. Бой — интерактивная
--     сущность с развёртыванием, ходами и дедлайном; сшитый втихую бот-бой,
--     который никто не открыл, повис бы мёртвым грузом и сорвал бы ходы. Флот
--     на карте — честная передача управления игроку: он сам решает, драться или
--     пропустить, а Легион ждёт на месте.
--   • НЕ ВСТРЕТИЛИ + цель колония → ГРАБЁЖ: угон населения (Легион не держава,
--     рабов себе не пишет — население просто пропадает) и порча каравана.
--   • Замысел 'blind' → ВЫБИВАНИЕ ЗАСТАВЫ: режем экипаж, пустую сворачиваем.
--     Отдельная цель ровно затем, чтобы схлопывать игроку радиус действия:
--     упала depot-застава — флот больше не дотягивается, упала recon —
--     следующий контакт придёт неопознанным.
--
-- Аггро растёт там, где Легион ПОЛУЧИЛ по зубам: отбитый налёт и разбитый
-- материализованный флот. Кто дерётся — того и навещают, это память, а не месть.
-- ════════════════════════════════════════════════════════════

-- ── 1. Кто в системе может дать сдачи ───────────────────────
create or replace function public._legion_defenders(p_sys text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(greatest(0,(c->>'qty')::int)),0)::int
    from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
   where f.system_id = p_sys and f.status = 'idle'
     and f.faction_id is distinct from public._legion_fid()
$$;
revoke all on function public._legion_defenders(text) from public;

-- ── 2. Состав отряда по вложенному давлению ─────────────────
-- Чем больше вложено, тем крупнее корпуса. Мелочь — корветы и эсминцы, удар —
-- крейсера и всё, что попадётся. Берём проекты Железного Дивизиона as is.
create or replace function public._legion_compose(p_strength numeric)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare want int; kinds text[]; comp jsonb := '[]'::jsonb; u record; left_n int;
begin
  want := greatest(1, round(coalesce(p_strength,12) / 8.0))::int;
  if p_strength >= 40 then
    kinds := array['mediumCruiser','cruiser','destroyer','corvette','supportCarrier'];
  elsif p_strength >= 22 then
    kinds := array['destroyer','corvette','mediumCruiser'];
  else
    kinds := array['corvette','destroyer'];
  end if;

  left_n := want;
  for u in select fu.id, fu.name from public.faction_units fu
            where fu.faction_id = (public._legion_meta()->>'hull_fid')
              and fu.category = 'ship'
              and (fu.data->>'class') = any(kinds)
            order by random() limit 3 loop
    exit when left_n <= 0;
    comp := comp || jsonb_build_array(jsonb_build_object(
      'unit_id', u.id, 'unit_name', u.name,
      'qty', greatest(1, ceil(left_n / 2.0)::int)));
    left_n := left_n - greatest(1, ceil(left_n / 2.0)::int);
  end loop;

  -- корпусов не нашлось (каталог подчистили) — пусто, вызывающий разберётся
  return comp;
end$$;
revoke all on function public._legion_compose(numeric) from public;

-- ── 3. Весточка жертве ──────────────────────────────────────
create or replace function public._legion_news(p_fid text, p_title text, p_body text)
returns void language sql security definer set search_path=public as $$
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
  select p_fid, '☠ ЖЕЛЕЗНЫЙ ЛЕГИОН', 'rgba(196,74,42,0.55)', null, null,
         p_title, null, p_body, 'published', now(), now(), now()
   where p_fid is not null;
$$;
revoke all on function public._legion_news(text,text,text) from public;

-- ── 4. ПРИЗЕМЛЕНИЕ ──────────────────────────────────────────
create or replace function public.legion_engage_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; def int; comp jsonb; col public.colonies; op public.outposts;
        abduct numeric; v_pop numeric; cut int; fid_new uuid;
        n_fight int := 0; n_plunder int := 0; n_blind int := 0; n_dud int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'landed' and fleet_id is null
            order by arrive_at loop

    -- ── 4a. ОСЛЕПЛЕНИЕ: выбить заставу ──────────────────────
    if k.kind = 'blind' then
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
          and mode in ('recon','depot')
        order by public._outpost_crew_k(crew, mode) desc limit 1;

      if op.id is null then
        -- заставу успели убрать сами: контакт впустую
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;

      -- обороняемая система бьёт по рукам: чем плотнее оборона, тем меньше урон
      cut := greatest(1, round(coalesce(op.crew,0) * 0.6
                               / greatest(1, public._legion_sys_guard(k.target_sys)))::int);
      update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;

      perform public._legion_news(k.target_fid,
        case when coalesce(op.crew,0) - cut <= 0
             then 'Застава потеряна' else 'Налёт на заставу' end,
        format('Отряд Железного Легиона ударил по %s-аванпосту в системе %s. Экипаж потерял %s человек%s',
          case op.mode when 'recon' then 'разведывательному' else 'заправочному' end,
          k.target_sys, cut,
          case when coalesce(op.crew,0) - cut <= 0
               then '. Станция брошена и будет свёрнута — сектор остался без глаз.'
               else '. Станция держится, но работает вполсилы.' end));

      update public.legion_contacts set state = 'spent' where id = k.id;
      n_blind := n_blind + 1;
      continue;
    end if;

    -- ── 4b. ВСТРЕТИЛИ: материализуемся во флот ──────────────
    def := public._legion_defenders(k.target_sys);
    if def > 0 then
      comp := public._legion_compose(k.strength);
      if jsonb_array_length(comp) = 0 then
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;
      insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
        values (public._legion_fid(), 'Ватага Легиона', 'idle',
                k.target_sys, k.target_sys, comp)
        returning id into fid_new;

      update public.legion_contacts
         set state = 'engaged', fleet_id = fid_new where id = k.id;

      perform public._legion_news(k.target_fid, 'Пираты в системе',
        format('Отряд Железного Легиона вышел из пустоты в системе %s и застал там ваши корабли. Ватага не уйдёт сама — её придётся выбивать.',
               k.target_sys));
      n_fight := n_fight + 1;
      continue;
    end if;

    -- ── 4c. НЕ ВСТРЕТИЛИ: грабёж ────────────────────────────
    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop := coalesce(col.pop, coalesce(col.cells,0) * 50);
      -- доля меньше, чем у игрока в _slavery (6%): Легион кусает часто и мелко,
      -- он налог, а не катастрофа
      abduct := least(400, floor(v_pop * 0.04));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies
           set pop = greatest(1, v_pop - abduct) where id = col.id;
      end if;
      perform public._legion_news(k.target_fid, 'Угон населения',
        format('Пираты Железного Легиона беспрепятственно вошли в систему %s: в колонии «%s» не оказалось ни одного корабля прикрытия. Угнано около %s жителей.',
               k.target_sys, coalesce(col.planet_name,'колония'), abduct));
      n_plunder := n_plunder + 1;
    else
      -- колонии нет — значит целью был караванный узел: рвём трассу
      update public.trade_routes
         set volume = greatest(0, coalesce(volume,0) * 0.75)
       where status = 'active'
         and (origin_sys = k.target_sys or dest_sys = k.target_sys)
         and (a_fid = k.target_fid or b_fid = k.target_fid);
      perform public._legion_news(k.target_fid, 'Караван разграблен',
        format('Ватага Легиона перехватила конвой у системы %s. Часть груза потеряна.', k.target_sys));
      n_plunder := n_plunder + 1;
    end if;

    update public.legion_contacts set state = 'spent' where id = k.id;
  end loop;

  return jsonb_build_object('ok', true, 'fights', n_fight,
                            'plunder', n_plunder, 'blinded', n_blind, 'duds', n_dud);
end$$;
revoke all on function public.legion_engage_tick() from public;

-- ── 5. РАЗБИТАЯ ВАТАГА ──────────────────────────────────────
-- Флот Легиона исчез с карты (выбили или он был распущен) — списываем потерю в
-- сектор и добавляем аггро тому, кто это сделал. Именно здесь давление,
-- вложенное в отряд, окончательно сгорает: возврата нет.
create or replace function public.legion_losses_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; n int := 0;
begin
  for k in select c.* from public.legion_contacts c
            where c.state = 'engaged' and c.fleet_id is not null
              and not exists (select 1 from public.fleets f where f.id = c.fleet_id) loop
    perform public._legion_lost(k.sector_id, k.strength);
    perform public._legion_aggro_add(k.target_fid, k.strength / 4.0,
              format('разбита ватага в системе %s', k.target_sys));
    update public.legion_contacts set state = 'spent' where id = k.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'lost', n);
end$$;
revoke all on function public.legion_losses_sweep() from public;

-- ── 5б. ОПОВЕЩЕНИЕ О ВСКРЫТОМ КОНТАКТЕ ──────────────────────
-- Депешу шлём ровно один раз и только на ступени resolved: ghost («в секторе
-- неспокойно») спамил бы каждые 15 минут и обесценил бы сам сигнал, а по
-- signature ещё не понять, к кому идут. Резолв — это уже знание, за которое
-- игрок заплатил полным экипажем recon-заставы, и оно стоит депеши.
create or replace function public.legion_contacts_notify()
returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; n int := 0;
begin
  for g in select s.contact_id, s.faction_id, k.target_sys, k.kind, k.arrive_at,
                  (k.target_fid = s.faction_id) mine
             from public.legion_sightings s
             join public.legion_contacts k on k.id = s.contact_id
            where s.grade = 'resolved' and not s.notified and k.state = 'inbound' loop
    perform public._legion_news(g.faction_id, 'Разведка: контакт вскрыт',
      format('Станция слежения вскрыла отряд Железного Легиона. Замысел — %s, цель — система %s%s. Подход около %s.',
        case g.kind when 'strike' then 'удар по колонии'
                    when 'blind'  then 'налёт на аванпост'
                    else 'разбой на трассе' end,
        g.target_sys,
        case when g.mine then ' (ваша)' else '' end,
        to_char(g.arrive_at, 'DD.MM HH24:MI')));
    update public.legion_sightings set notified = true
     where contact_id = g.contact_id and faction_id = g.faction_id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'notified', n);
end$$;
revoke all on function public.legion_contacts_notify() from public;

-- ── 6. ЦИКЛ ─────────────────────────────────────────────────
-- Каждые 15 минут, сразу после скана контактов: долетевший контакт должен
-- разрешаться быстро, иначе игрок видит «прибыл» и ничего не происходит.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-engage-tick')
      where exists (select 1 from cron.job where jobname = 'legion-engage-tick');
    perform cron.schedule('legion-engage-tick', '8,23,38,53 * * * *',
      'select public.legion_losses_sweep(); select public.legion_engage_tick(); select public.legion_contacts_notify();');
  end if;
end$$;
