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

-- ════════════════════════════════════════════════════════════════════════════
--  СЕРВЕРНЫЙ ЗАМОК — ГЛАВНОЕ. UI-баннер прячет кнопки, но казино-RPC выданы роли
--  authenticated, и нарушители зовут их НАПРЯМУЮ через REST/консоль (минуя UI).
--  Поэтому отзываем право вызова у всех игрок-facing точек входа казино:
--  открытие/покупка/продажа/закрытие. Оставляем *_settle (нужны тику) и *_status
--  (нужны UI на чтение) — они денег не печатают. Revoke обратим: при возврате
--  инструментов после корневого фикса просто выдашь grant снова.
-- ════════════════════════════════════════════════════════════════════════════
revoke execute on function public.index_buy(numeric)                       from authenticated, anon;
revoke execute on function public.index_sell(numeric)                      from authenticated, anon;
revoke execute on function public.margin_open(text,text,numeric,numeric)   from authenticated, anon;
revoke execute on function public.margin_close(uuid)                       from authenticated, anon;
revoke execute on function public.futures_open(text,text,numeric,numeric,int) from authenticated, anon;
revoke execute on function public.futures_close(uuid)                      from authenticated, anon;
revoke execute on function public.options_buy(text,text,numeric,numeric,int)  from authenticated, anon;
revoke execute on function public.options_close(uuid)                      from authenticated, anon;
revoke execute on function public.bond_buy(uuid,int)                       from authenticated, anon;

-- PostgREST: сбросить кэш схемы, чтобы отзыв подхватился сразу
notify pgrst, 'reload schema';

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
