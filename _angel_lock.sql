-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 6: ЗАМОК. КТО ВООБЩЕ МОЖЕТ ЗВАТЬ ЭТИ ДВЕРИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: последним в цепочке, после _angel_board_seal.sql. Катать ПОВТОРНО
-- после любого наката ангельских файлов — `create or replace` заводит функции
-- заново и вместе с ними заново выдаёт права по умолчанию.
--
-- ЧТО СЛУЧИЛОСЬ. Во всех ангельских файлах стояло `revoke all on function ...
-- from public` — и оно НЕ РАБОТАЛО. В Supabase на схему public висит
-- ALTER DEFAULT PRIVILEGES, который выдаёт EXECUTE напрямую ролям `anon` и
-- `authenticated`. Это ИМЕНОВАННЫЕ роли, а `PUBLIC` — псевдороль «все
-- остальные»; отзыв у PUBLIC именных грантов не трогает. Проверка ACL показала
-- `authenticated=X/postgres` на КАЖДОЙ функции, включая:
--
--   • angel_ascend(fid)      — любой игрок превращает ЛЮБУЮ державу в ангела,
--                              стирая её колонии. Ту самую кнопку, которой «не
--                              должно быть», мог нажать кто угодно;
--   • angel_descend(fid)     — и отменить ангела обратно;
--   • _angel_fall(fid)       — удалить ангела одним вызовом, без единого залпа;
--   • _angel_take_salvo(...) — снимать печати без Длани, без снарядов, без
--                              стволов и без кулдауна — то есть убить кризис
--                              за секунду скриптом из консоли браузера;
--   • _angel_tithe/_doom/_hunter/_send/_declare — водить чужой ИИ за руку.
--
-- ⚠️ ТА ЖЕ ДЫРА ЕСТЬ У ВСЕГО ПРОЕКТА: `_doom_resolve`, `_fleet_settle`,
-- `_legion_news` и прочие «внутренние» функции с таким же revoke открыты
-- ровно так же. Это НЕ чинится здесь (тут только ангел), но знать надо —
-- см. [[client-write-rls-hole]].
--
-- КАК ЧИНИМ, В ДВА СЛОЯ. Одного revoke мало: следующий же `create or replace`
-- вернёт права по умолчанию, и дыра откроется снова, молча.
--   1) ОТЗЫВ по списку — перебором из каталога, а не руками: функцию, которую
--      забыли вписать, забыть невозможно.
--   2) ЗАСОВ ВНУТРИ самих разрушительных дверей — проверка прав в теле. Даже
--      если права когда-нибудь протекут обратно, вознесение и низвержение
--      останутся недоступны игроку.
-- ════════════════════════════════════════════════════════════

-- ── 1. ОТЗЫВ ПРАВ ───────────────────────────────────────────
-- Наружу оставляем ровно три двери, и каждая обязана иметь СВОЮ проверку:
--   angel_status()     — только чтение, чужим отдаёт шум (цензура внутри);
--   angel_incoming()   — внутри сверяет, что зовёт сама держава-ангел;
--   doom_fire_angel()  — действие игрока, внутри сверяет владение стволом.
-- Всё остальное — машинерия: её зовут крон и другие security definer функции,
-- которым права роли вызывающего не нужны вовсе.
do $$
-- ⚠️ ПРЕДИКАТЫ ЧТЕНИЯ ЗАКРЫВАТЬ НЕЛЬЗЯ. 19.08 отзыв прав на _angel_is положил
-- сайт на час: её зовёт public._bt_is_machine, которая НЕ security definer, то
-- есть исполняется с правами ИГРОКА. Каждое обращение к боевой доске и каждый
-- прогон legion_ai_tick падали с «permission denied for function _angel_is».
-- Права проверяются по ЭФФЕКТИВНОМУ пользователю в момент вызова — перед любым
-- revoke смотреть не только клиент, но и НЕ-definer функции среди вызывающих.
-- Эти четыре ничего не делают и ничего не скрывают (всё есть в angel_status).
declare f record; kept text[] := array['angel_status', 'angel_incoming', 'doom_fire_angel',
                                       'angel_target',
                                       'admin_angel_ascend', 'admin_angel_descend',
                                       'admin_angel_seals', 'admin_angel_tick',
                                       '_angel_is', '_angel_alive', '_angel_fid', '_angel_const'];
        n int := 0;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and (p.proname like 'angel\_%' or p.proname like '\_angel\_%')
       and not (p.proname = any(kept))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice 'Престол: закрыто функций — %', n;
end$$;

-- Админские двери остаются вызываемыми (иначе админка их не достанет), но
-- каждая из них уже проверяет current_user_role() в теле — см. _angel_core.sql.
grant execute on function public.admin_angel_ascend(text)  to authenticated;
grant execute on function public.admin_angel_descend(text) to authenticated;
grant execute on function public.admin_angel_seals(text, numeric) to authenticated;
grant execute on function public.admin_angel_tick() to authenticated;
-- Панель ангела читают все, кто вообще видит карту (включая гостей).
grant execute on function public.angel_status() to authenticated, anon;
grant execute on function public.angel_incoming() to authenticated;
grant execute on function public.doom_fire_angel(uuid) to authenticated;
-- Отметка Престола для пульта штаба (_doom_shell_throne.sql): только «где он».
grant execute on function public.angel_target() to authenticated, anon;
-- Горячий путь боевой доски: см. предупреждение у списка kept выше.
grant execute on function public._angel_is(text)    to authenticated, anon;
grant execute on function public._angel_alive(text) to authenticated, anon;
grant execute on function public._angel_fid()       to authenticated, anon;
grant execute on function public._angel_const(text) to authenticated, anon;

-- ── 2. ЗАСОВ ВНУТРИ ─────────────────────────────────────────
-- Права можно потерять по неосторожности одним `create or replace`. Проверка в
-- ТЕЛЕ функции теряется только вместе с самой функцией, поэтому вознесение и
-- низвержение защищены ещё и здесь.
--
-- Правило: если у вызова есть живая сессия (auth.uid() не пуст) — это игрок или
-- админ, и мы требуем штабную роль. Если сессии нет — это прямое подключение к
-- базе (tools/db_run.js) или крон, то есть тот, у кого и так есть всё.
create or replace function public._angel_staff_only()
returns void language plpgsql stable security definer set search_path=public as $$
declare who uuid; role text;
begin
  begin who := auth.uid(); exception when others then who := null; end;
  if who is null then return; end if;          -- прямое подключение к БД / крон
  begin role := public.current_user_role(); exception when others then role := null; end;
  if role is null or role not in ('superadmin', 'editor') then
    raise exception 'forbidden: вознесение и низвержение — не игровое действие';
  end if;
end$$;
revoke all on function public._angel_staff_only() from public, anon, authenticated;

-- Сам засов вызывается ПЕРВОЙ СТРОКОЙ в теле angel_ascend и angel_descend —
-- см. _angel_core.sql. Обёртку тут не строим намеренно: лишняя функция поверх
-- существующей — это ещё одно место, где можно разойтись с оригиналом.

notify pgrst, 'reload schema';
