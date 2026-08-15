-- ============================================================
-- ОПОВЕЩЕНИЯ · СЧЁТЧИК НА КАЖДЫЙ РАЗДЕЛ КАБИНЕТА
--
-- ⚠️ ПОЧЕМУ ЭТО ПОЯВИЛОСЬ. Игра сообщала о себе только тем, что игрок сам
-- открывал ведомство и смотрел. Заявка на службу, предложение мира, приглашение
-- в союз, встречный обмен, готовая операция разведки, выкуп за пленённого
-- агента, законченное исследование, принятая стройка, исполненный заказ на
-- бирже, ответ поддержки — всё это случалось молча. На полтора десятка
-- ведомств бейдж был ОДИН («Двор», fm_me.inbox) и ещё один самодельный у
-- «Горячих точек».
--
-- ⚠️ СЧЁТ ИДЁТ ПО ВКЛАДКАМ, А НЕ ПО ВЕДОМСТВАМ. Цифра на «Внешней политике»
-- отвечает «где-то там что-то есть» и заставляет обойти семь разделов рельсы.
-- Ключ канала поэтому `ведомство.вкладка` («dipl.alliance»), и бейдж садится
-- ровно на тот раздел, где лежит дело. Ведомственная цифра на двери — СУММА
-- своих вкладок, а не отдельный источник правды.
--
-- ЗДЕСЬ НЕ ЗАВОДИТСЯ ЛЕНТА УВЕДОМЛЕНИЙ. Ленту пришлось бы наполнять из полусотни
-- мест, чистить и разъезжаться с реальностью. Счётчики СЧИТАЮТСЯ ПО ЖИВЫМ
-- ДАННЫМ — по тем же таблицам, которые вкладка и так показывает. Бейдж не может
-- разойтись с разделом: он и есть его пересчёт.
--
-- ДВЕ ПОРОДЫ СЧЁТЧИКОВ, и разница видна игроку цветом:
--   • ДЕЛО ('todo') — ЖДЁТ РЕШЕНИЯ. Метка «прочитано» ему не нужна и была бы
--     враньём: заявку можно увидеть и не решить, а она всё равно висит. Гаснет
--     САМО, когда дело сделано, — строка ушла из выборки.
--   • НОВОЕ ('new')  — достаточно прочесть. Считается ОТ МЕТКИ ПРОСМОТРА
--     (notif_seen): открыл вкладку — клиент зовёт notif_mark, счётчик обнулился.
--
-- ЧЕГО ЗДЕСЬ НАРОЧНО НЕТ. Вкладки, у которых нет «ждущей» строки в базе
-- («Залежи», «Рынок», «Курс державы», «Обзор»), счётчика не получили: рисовать
-- им ноль — значит приучить игрока не смотреть на бейджи вообще.
--
-- Требует: _ec_my_fid (_economy_setup.sql), _fm_own_fid (_faction_members.sql),
--          spy_incoming (_spy_incoming_alerts.sql), news_mentions (_news_mentions.sql).
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── Метки просмотра ──────────────────────────────────────────
-- Одна строка = один канал одного пользователя. Метка ЛИЧНАЯ (user_id), а не
-- фракционная: соправители читают порознь, и «прочитано» одного не должно
-- гасить бейдж другому.
create table if not exists public.notif_seen (
  user_id uuid  not null references auth.users(id) on delete cascade,
  chan    text  not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, chan)
);

alter table public.notif_seen enable row level security;
drop policy if exists notif_seen_own on public.notif_seen;
create policy notif_seen_own on public.notif_seen
  for select using (user_id = auth.uid());
-- Писать — только через notif_mark (security definer): клиенту прямая запись не
-- нужна, а дыра «поставь себе метку в будущее» не нужна тем более.
revoke insert, update, delete on public.notif_seen from authenticated, anon;

-- Отсечка «нового» для канала. Первый заход (метки нет) — не заваливаем игрока
-- всей историей мира: считаем, что он видел всё, что старше суток.
create or replace function public._notif_since(p_chan text)
returns timestamptz language sql stable security definer set search_path=public as $$
  select coalesce((select s.seen_at from public.notif_seen s
                     where s.user_id = auth.uid() and s.chan = p_chan),
                  now() - interval '1 day');
$$;

-- ── Счётчики ─────────────────────────────────────────────────
-- Возвращает {канал: число}. Каналы с нулём НЕ выбрасываются: клиенту удобнее
-- получить полный набор ключей, чем гадать, канал пуст или его не посчитали.
-- Каждый счёт обёрнут в свой begin/exception: если фича не накатана в этой базе
-- (её таблицы нет) — молчим нулём, а не роняем весь ответ.
create or replace function public.notif_counts()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_fid text; v_own text;
  o jsonb := '{}'::jsonb;
  n int; ts timestamptz;
begin
  if auth.uid() is null then return o; end if;
  begin v_fid := public._ec_my_fid();  exception when others then v_fid := null; end;
  begin v_own := public._fm_own_fid(); exception when others then v_own := null; end;

  -- ═══ ВНУТРЕННЯЯ ПОЛИТИКА ═══════════════════════════════════
  -- Двор: заявки на службу, ждущие решения владельца. Тот же счёт, что
  -- fm_me.inbox, — не второй источник правды, а он же в общем ответе.
  n := 0;
  if v_own is not null then
    begin select count(*) into n from public.faction_members r
             where r.faction_id = v_own and r.status = 'pending';
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('ipol.court', n);

  -- Вера: нас зовут в чужую веру — принять или отказать.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.faith_offers f
             where f.to_fid = v_fid and f.status = 'pending';
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('ipol.faith', n);

  -- ═══ ВНЕШНЯЯ ПОЛИТИКА ══════════════════════════════════════
  -- Война: предложения мира/капитуляции/вступления, ждущие ответа.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.war_offers w
             where w.to_fid = v_fid and w.status = 'pending';
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('dipl.war', n);

  -- Союзы: три разных предложения об одном — «войти под чужое имя», и все три
  -- решаются в одной вкладке, поэтому и счётчик у них общий.
  n := 0;
  if v_fid is not null then
    begin
      select (select count(*) from public.diplo_invites i where i.fid = v_fid and i.status = 'pending')
           + (select count(*) from public.diplo_vassals v where v.vassal_fid = v_fid and v.status = 'pending')
           + (select count(*) from public.state_annexations a where a.minor_fid = v_fid and a.status = 'pending')
        into n;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('dipl.alliance', n);

  -- Кредиты: спор по займу (в любую сторону) — он не рассосётся сам.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.loans l
             where (l.borrower_fid = v_fid or l.lender_fid = v_fid) and l.status = 'disputed';
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('dipl.loans', n);

  -- ═══ ТОРГОВЛЯ ══════════════════════════════════════════════
  -- Обмен: встречные предложения бартера И продажи технологий/чертежей — обе
  -- формы лежат в одной вкладке «Обмен» (ecTradeSubBody('barter')).
  n := 0;
  if v_fid is not null then
    begin
      select (select count(*) from public.barter_offers b where b.to_fid = v_fid and b.status = 'pending')
           + (select count(*) from public.tech_offers t where t.buyer_fid = v_fid and t.status = 'pending')
        into n;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('trade.barter', n);

  -- ═══ БИРЖА ═════════════════════════════════════════════════
  -- Заказы: мои закрылись, пока меня не было. Читаемое, не дело.
  n := 0;
  if v_fid is not null then
    begin
      ts := public._notif_since('exch.orders');
      select count(*) into n from public.exchange_orders x
        where x.buyer_fid = v_fid and x.status = 'filled'
          and coalesce(x.updated_at, x.created_at) > ts;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('exch.orders', n);

  -- ═══ КОЛОНИИ И НАУКА ═══════════════════════════════════════
  -- Стройки и терраформ, у которых вышел срок.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.colony_projects p
             where p.faction_id = v_fid and p.ready_at is not null and p.ready_at <= now();
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('planets', n);

  -- Исследования, у которых вышел срок (оба слота): слот стоит пустой, пока
  -- игрок не снимет готовое.
  n := 0;
  if v_fid is not null then
    begin
      select (case when e.research_active  is not null and e.research_ready  is not null
                        and e.research_ready  <= now() then 1 else 0 end)
           + (case when e.research_active2 is not null and e.research_ready2 is not null
                        and e.research_ready2 <= now() then 1 else 0 end)
        into n from public.faction_economy e where e.faction_id = v_fid;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('research', coalesce(n, 0));

  -- ═══ РАЗВЕДКА ══════════════════════════════════════════════
  -- Свои операции, у которых вышел срок: агенты стоят без дела, пока не снимешь.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.spy_missions m
             where m.actor_fid = v_fid and m.status = 'active'
               and m.ready_at is not null and m.ready_at <= now();
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('intel.ops', coalesce(n, 0));

  -- Выкуп за моего пленённого агента: за него просят цену.
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.spy_ransoms r
             where r.owner_fid = v_fid and r.status = 'pending';
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('intel.ransom', coalesce(n, 0));

  -- Входящие тайные операции против меня. spy_incoming уже соблюдает правила
  -- раскрытия исполнителя — здесь только считаем строки, ничего не раскрывая.
  n := 0;
  begin
    ts := public._notif_since('intel.incoming');
    select count(*) into n from public.spy_incoming() s where s.created_at > ts;
  exception when others then n := 0; end;
  o := o || jsonb_build_object('intel.incoming', coalesce(n, 0));

  -- ═══ ВЕСТНИК ═══════════════════════════════════════════════
  -- «Оповещения» вестника: сектор назвал мою державу.
  n := 0;
  if v_fid is not null then
    begin
      ts := public._notif_since('press.notif');
      select count(*) into n from public.news_mentions(100) m
        where coalesce(m.published_at, m.created_at) > ts;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('press.notif', least(coalesce(n, 0), 99));

  -- Модерация: записи, ждущие вердикта. Считаем ТОЛЬКО тем, кто их и правда
  -- судит, — у остальных вкладки «Модерация» нет вовсе (EST_SCR.press.hide).
  n := 0;
  begin
    if exists (select 1 from public.user_roles r
                 where r.user_id = auth.uid()
                   and coalesce(r.role,'') in ('superadmin','editor','moderator')) then
      select count(*) into n from public.faction_news f where f.status = 'pending';
    end if;
  exception when others then n := 0; end;
  o := o || jsonb_build_object('press.mod', coalesce(n, 0));

  -- ═══ СТАТИСТИКА ════════════════════════════════════════════
  -- Достижения, полученные с прошлого захода: похвалу читают, а не «решают».
  n := 0;
  if v_fid is not null then
    begin
      ts := public._notif_since('stat.ach');
      select count(*) into n from public.faction_achievements a
        where a.faction_id = v_fid and a.earned_at > ts;
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('stat.ach', coalesce(n, 0));

  -- ═══ ВНЕ КАБИНЕТА ══════════════════════════════════════════
  -- Бой ждёт МОЕГО хода. Именно хода, а не «идёт бой»: пока ходит противник,
  -- звать игрока не за чем. Ведёт на страницу «Горячие точки».
  n := 0;
  if v_fid is not null then
    begin select count(*) into n from public.battles b
             where b.status = 'active'
               and ((b.attacker_fid = v_fid and b.side_to_move = 'attacker')
                 or (b.defender_fid = v_fid and b.side_to_move = 'defender'));
    exception when others then n := 0; end;
  end if;
  o := o || jsonb_build_object('battle', coalesce(n, 0));

  -- Сводка сектора: чужие одобренные записи свежее метки (стол приёмной).
  n := 0;
  begin
    ts := public._notif_since('news');
    select count(*) into n from public.faction_news f
      where f.status = 'approved'
        and (v_fid is null or f.faction_id is distinct from v_fid)
        and coalesce(f.published_at, f.created_at) > ts;
  exception when others then n := 0; end;
  o := o || jsonb_build_object('news', least(coalesce(n, 0), 99));

  -- Поддержка: ответы стаффа в МОИХ обращениях (окно тикетов, не кабинет).
  n := 0;
  begin
    ts := public._notif_since('ticket');
    select count(*) into n from public.ticket_messages tm
      join public.tickets t on t.id = tm.ticket_id
      where t.user_id = auth.uid() and tm.is_staff = true and tm.created_at > ts;
  exception when others then n := 0; end;
  o := o || jsonb_build_object('ticket', coalesce(n, 0));

  return o;
end$$;

revoke all on function public.notif_counts() from public, anon;
grant execute on function public.notif_counts() to authenticated;

-- ── Отметить канал прочитанным ───────────────────────────────
-- Метка ставится ТОЛЬКО на now(): клиент не передаёт время, поэтому «прочитал
-- вперёд на неделю» невозможно. Каналы-дела принимаются молча и ничего не
-- меняют — им метка не нужна (см. шапку), но клиенту проще звать одинаково.
create or replace function public.notif_mark(p_chan text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return; end if;
  if p_chan is null or p_chan not in
     ('news','ticket','exch.orders','intel.incoming','press.notif','stat.ach') then return; end if;
  insert into public.notif_seen(user_id, chan, seen_at)
    values (auth.uid(), p_chan, now())
  on conflict (user_id, chan) do update set seen_at = excluded.seen_at;
end$$;

revoke all on function public.notif_mark(text) from public, anon;
grant execute on function public.notif_mark(text) to authenticated;

-- Проверка (необязательно):
-- select public.notif_counts();
