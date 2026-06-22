-- ============================================================================
--  БИРЖА · ЗАМОРОЗКА КАЗИНО — обнуление всех открытых позиций
--  Применять в Supabase → SQL Editor ОДИН РАЗ. Идемпотентно (повторный прогон
--  ничего не находит — открытых позиций уже нет).
--
--  ЗАЧЕМ. Индекс / маржа / фьючерсы / опционы манипулируемы (раскачка живой цены
--  спотовыми ордерами + расчёт против бесконечного «дома») и напечатали фракциям
--  миллиарды. UI этих инструментов закрыт баннером (economy.js EC_EX_CLOSED).
--  Этот срез закрывает/сжигает ВСЕ открытые позиции БЕЗ ВЫПЛАТЫ:
--    • залог/премия уже были списаны при открытии — деньги не возвращаются;
--    • казна (faction_economy.gc) НЕ трогается — только позиции;
--    • realized проставляется в минус (потерян залог/премия) для журнала.
--  Это останавливает дальнейшее печатание ГС, но НЕ откатывает уже выведенные
--  на руки миллиарды (это отдельный кейс — см. примечание в конце).
-- ============================================================================

-- ── Маржа: закрыть открытые без выплаты (залог сгорел) ──────────────────────
update public.margin_positions
   set status     = 'closed',
       exit_price = coalesce(exit_price, entry_price),
       realized   = -collateral,
       closed_at  = now()
 where status = 'open';

-- ── Фьючерсы: то же — открытые гасятся без расчёта ──────────────────────────
update public.futures_positions
   set status     = 'closed',
       exit_price = coalesce(exit_price, entry_price),
       realized   = -collateral,
       closed_at  = now()
 where status = 'open';

-- ── Опционы: открытые гасятся без исполнения (премия сгорела) ───────────────
update public.option_positions
   set status    = 'closed',
       exit_spot = coalesce(exit_spot, spot_entry),
       payout    = 0,
       realized  = -premium_paid,
       closed_at = now()
 where status = 'open';

-- ── Индекс (ETF): обнулить паи и базис у всех держателей (без выкупа) ────────
update public.index_holdings
   set units      = 0,
       basis      = 0,
       updated_at = now()
 where units <> 0 or basis <> 0;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- Должно быть 0 во всех строках:
select 'margin_open'  as what, count(*) from public.margin_positions  where status = 'open'
union all
select 'futures_open',         count(*) from public.futures_positions where status = 'open'
union all
select 'options_open',         count(*) from public.option_positions  where status = 'open'
union all
select 'index_units',          count(*) from public.index_holdings    where units <> 0;

-- ── ПРИМЕЧАНИЕ: откат уже выведенных миллиардов ──────────────────────────────
-- Этот срез гасит ПОЗИЦИИ. Если нужно урезать раздутый gc у фракций-нарушителей,
-- это отдельная ручная правка faction_economy.gc — её делаем после анализа
-- (по аномальному балансу / истории realized). Здесь казна намеренно не тронута.
