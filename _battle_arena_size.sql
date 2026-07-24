-- ═══════════════════════════════════════════════════════════════════
-- 📐 РАЗМЕР АРЕНЫ — СВОЙСТВО БОЯ, А НЕ ГЛОБАЛЬНАЯ КОНСТАНТА
--
-- Раньше _bt_w()/_bt_h() возвращали фикс-размер на ВСЕ бои сразу.
-- Теперь размер хранится на строке боя (battles.bw/bh):
--   • обычные бои (meeting/intercept)  → 60×80  (большая доска)
--   • дуэли Бойцовского клуба (duel)    → 48×28  (как было — не раздуваем)
--
-- Технически: _bt_w()/_bt_h() читают транзакционную настройку bt.w/bt.h,
-- которую в начале каждого боевого RPC взводит _bt_arm(battle). Если не
-- взведено (какой-то старый вызов) — падаем на большой борт.
--
-- ПОРЯДОК ПРИМЕНЕНИЯ:
--   1) ЭТОТ файл (_battle_arena_size.sql)
--   2) заново _war_battle_tactics.sql  (в нём добавлены вызовы _bt_arm)
--   3) заново _fight_club.sql          (fc_watch_state армится; дуэль знает свой размер)
-- Идемпотентно, можно гонять повторно.
-- ═══════════════════════════════════════════════════════════════════

-- ── размеры по видам боя (одно место правды) ─────────────────────────
create or replace function public._bt_wbig()  returns int language sql immutable as $$ select 60 $$;
create or replace function public._bt_hbig()  returns int language sql immutable as $$ select 80 $$;
create or replace function public._bt_wduel() returns int language sql immutable as $$ select 48 $$;
create or replace function public._bt_hduel() returns int language sql immutable as $$ select 28 $$;

-- ── колонки размера на бое ───────────────────────────────────────────
alter table public.battles add column if not exists bw int;
alter table public.battles add column if not exists bh int;

-- дефолт по виду боя при вставке (duel → маленькая, остальное → большая)
create or replace function public._bt_size_default() returns trigger
language plpgsql as $$
begin
  if new.bw is null then
    new.bw := case when new.kind = 'duel' then public._bt_wduel() else public._bt_wbig() end;
  end if;
  if new.bh is null then
    new.bh := case when new.kind = 'duel' then public._bt_hduel() else public._bt_hbig() end;
  end if;
  return new;
end$$;
drop trigger if exists trg_bt_size_default on public.battles;
create trigger trg_bt_size_default before insert on public.battles
  for each row execute function public._bt_size_default();

-- проставить размеры уже существующим боям
update public.battles set
  bw = coalesce(bw, case when kind = 'duel' then public._bt_wduel() else public._bt_wbig() end),
  bh = coalesce(bh, case when kind = 'duel' then public._bt_hduel() else public._bt_hbig() end)
 where bw is null or bh is null;

-- ── _bt_w()/_bt_h() теперь читают транзакционный размер ───────────────
-- stable (не immutable): значение зависит от настройки текущей транзакции.
create or replace function public._bt_w() returns int language sql stable as $$
  select coalesce(nullif(current_setting('bt.w', true), '')::int, public._bt_wbig()) $$;
create or replace function public._bt_h() returns int language sql stable as $$
  select coalesce(nullif(current_setting('bt.h', true), '')::int, public._bt_hbig()) $$;

-- ── взвести размер поля из строки боя на текущую транзакцию ───────────
-- Вызывается ПЕРВЫМ делом в каждом боевом RPC. is_local=true → живёт до
-- конца транзакции и виден всем вложенным вызовам (границы, спавн, реgenerate).
create or replace function public._bt_arm(p_battle uuid) returns void
language plpgsql security definer set search_path=public as $$
declare vw int; vh int;
begin
  select b.bw, b.bh into vw, vh from public.battles b where b.id = p_battle;
  perform set_config('bt.w', coalesce(vw, public._bt_wbig())::text, true);
  perform set_config('bt.h', coalesce(vh, public._bt_hbig())::text, true);
end$$;
grant execute on function public._bt_arm(uuid) to authenticated;
