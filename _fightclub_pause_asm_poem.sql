-- ════════════════════════════════════════════════════════════════════
-- 🥊 НЕДЕЛЯ ИГР: пауза экономических эффектов Ассамблеи и Поэмы.
--
-- UI Поэмы/Ассамблеи в клиенте спрятан на время Бойцовского клуба, но
-- серверные ленивые дозоры (_asm_ensure / _poem_ensure) всё равно
-- дорезолвливают просроченные фазы и ПРИМЕНЯЮТ эффекты к faction_economy.
-- Этот патч глушит ТОЛЬКО экономический эффект — сами машины состояний,
-- новости и леджер-обёртки не трогаем, чтобы ничего не падало.
--
-- Катить ПОСЛЕ _vn_assembly.sql, _vn_poem.sql и _galactic_ledger.sql
-- (перекрывает их версии _asm_law_apply / _poem_apply_effect последним).
-- Идемпотентно. Чтобы вернуть эффекты — просто перекатить _galactic_ledger.sql.
-- ════════════════════════════════════════════════════════════════════

-- ── Ассамблея: закон принимается, но казну/науку/товары не двигает ──
create or replace function public._asm_law_apply(p_law jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- 🥊 Пауза на время Недели игр: эффект закона не применяется.
  return;
end$$;
revoke all on function public._asm_law_apply(jsonb) from public, anon, authenticated;

-- ── Поэма: итог недели считается символически, экономику не трогает ──
create or replace function public._poem_apply_effect(p_week date)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  -- 🥊 Пауза на время Недели игр: недельный штрих к экономике не применяется.
  return jsonb_build_object('theme', 'mixed', 'tone', 'none', 'mult', 1,
    'title', 'Поэма на паузе',
    'descr', 'Пока идёт Неделя игр (Бойцовский клуб), недельный эффект Поэмы не применяется.');
end$$;
revoke all on function public._poem_apply_effect(date) from public, anon, authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public._poem_apply_effect(date_trunc('week', now())::date);
--   → tone='none', казна не изменилась.
-- Ассамблея: провести закон → galactic_ledger по 'assembly' пуст,
--   faction_economy без изменений.
