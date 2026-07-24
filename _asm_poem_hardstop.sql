-- ════════════════════════════════════════════════════════════════════
-- 🛑 ЖЁСТКАЯ ОСТАНОВКА Ассамблеи и Поэмы (до 03.08).
--
-- Проблема: пауза (_fightclub_pause_asm_poem.sql) перекрывалась, если после
-- неё повторно катали _galactic_ledger.sql — оба переопределяют одни и те же
-- функции _asm_law_apply / _poem_apply_effect, и «последний победил» вернул
-- поборы. Этот файл — ФИНАЛЬНОЕ слово: катить ПОСЛЕДНИМ, после ВСЕГО
-- остального. Идемпотентно. Вернуть эффекты — перекатить _galactic_ledger.sql.
--
-- Делает три вещи:
--   1) Глушит экономический эффект законов Ассамблеи (в т.ч. «Чрезвычайную
--      подать» gal_levy) и недельный штрих Поэмы — казну/науку/товары не трогают.
--   2) Паркует любой активный/идущий созыв Ассамблеи в 'done', чтобы ленивый
--      дозор _asm_ensure ничего больше не авто-принимал.
--   3) Чистит уже накопленные строки Ассамблеи/Поэмы в galactic_ledger, чтобы
--      панель «🌌 Галактические эффекты» не показывала старый минус.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Ассамблея: закон принимается символически, экономику не двигает ──
create or replace function public._asm_law_apply(p_law jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- 🛑 Пауза до 03.08: эффект закона (в т.ч. gal_levy «Чрезвычайная подать») отключён.
  return;
end$$;
revoke all on function public._asm_law_apply(jsonb) from public, anon, authenticated;

-- ── 2. Поэма: недельный итог символический, экономику не трогает ──
create or replace function public._poem_apply_effect(p_week date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  -- 🛑 Пауза до 03.08: недельный эффект Поэмы не применяется.
  return jsonb_build_object('theme', 'mixed', 'tone', 'none', 'mult', 1,
    'title', 'Поэма на паузе',
    'descr', 'Активность на паузе до 03.08 — недельный эффект не применяется.');
end$$;
revoke all on function public._poem_apply_effect(date) from public, anon, authenticated;

-- ── 3. Остановить любой идущий/собирающийся созыв, чтобы дозор не авто-принимал ──
update public.assembly_convocations
  set status = 'done',
      winner = coalesce(winner, 'none'),
      win_reason = coalesce(win_reason, 'paused'),
      finished_at = coalesce(finished_at, now())
  where status in ('signup', 'active');

-- ── 4. Убрать старые строки Ассамблеи/Поэмы из леджера (панель обзора) ──
delete from public.galactic_ledger where source in ('assembly', 'poem');

-- ── Проверка ────────────────────────────────────────────────
-- select prosrc from pg_proc where proname='_asm_law_apply';  -- должно быть 'return;'
-- select count(*) from public.galactic_ledger where source in ('assembly','poem');  -- 0
-- select status, count(*) from public.assembly_convocations group by status;        -- нет signup/active
