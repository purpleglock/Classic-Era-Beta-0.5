-- ============================================================
-- ЭТАП 2i — ГОНКА ПОГАШЕНИЯ КРЕДИТА (double-repay + overdraw)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыры в loan_repay:
--   1) double-repay: параллельные вызовы одного займа читают status='active',
--      оба переводят деньги и ставят 'repaid' → кредитор получает 2×, заёмщик
--      платит 2× (чистая прибыль кредитору при сговоре/втором аккаунте).
--   2) overdraw: списание `gc=gc-amount` без guard.
--
-- Фикс:
--   • статус-гейт: сначала атомарно `update loans set status='repaid'
--     where id=? and status in (active,disputed)`. Только ОДИН вызов пройдёт.
--   • списание с guard `and gc>=amount`. Если не хватило — raise (вся функция
--     одна транзакция → статус-апдейт откатится вместе с ней).
-- ============================================================

create or replace function public.loan_repay(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; l public.loans;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into l from public.loans where id=p_id;
  if not found then raise exception 'loan not found'; end if;
  if l.borrower_fid <> app.faction_id then raise exception 'not borrower'; end if;

  -- статус-гейт: только один параллельный вызов переведёт займ в repaid
  update public.loans set status='repaid' where id=p_id and status in ('active','disputed');
  if not found then raise exception 'not repayable'; end if;

  -- списание заёмщика с guard (защита от overdraw); raise откатит и статус
  update public.faction_economy set gc=gc-l.amount where faction_id=l.borrower_fid and gc>=l.amount;
  if not found then raise exception 'not enough to repay'; end if;
  update public.faction_economy set gc=gc+l.amount where faction_id=l.lender_fid;

  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.loan_repay(uuid) from public;
grant execute on function public.loan_repay(uuid) to authenticated;
