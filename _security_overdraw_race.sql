-- ============================================================
-- ЭТАП 2h — ГОНКА OVERDRAW (переводы/кредиты) — деньги из воздуха
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыра: списание делалось `update gc = gc - amount` БЕЗ guard в самом UPDATE.
--   Параллельные вызовы читают старый баланс, оба проходят `if gc < amount`,
--   оба списывают → баланс уходит в минус, у получателя появляется лишний ГС.
--
-- Фикс: списание атомарно — `update ... set gc=gc-amount where ... and gc>=amount`,
--   и если 0 строк (не хватило при гонке) → откат с 'not enough'. Тот же приём,
--   что в purchase-RPC (они уже безопасны).
-- Логика не меняется, только списание делается race-safe.
-- ============================================================

-- ── Передача ресурсов (gc/tnp/science) ──────────────────────
create or replace function public.economy_transfer(p_to_fid text, p_res text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; cur numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  if p_res not in ('gc','tnp','science') then raise exception 'bad resource'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'cannot transfer to self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;
  perform 1 from public.faction_economy where faction_id=p_to_fid;
  if not found then raise exception 'recipient has no economy'; end if;

  -- списание АТОМАРНО (guard в UPDATE) — параллельные переводы не уведут в минус
  if p_res='gc' then
    update public.faction_economy set gc=gc-p_amount where faction_id=app.faction_id and gc>=p_amount;
    if not found then raise exception 'not enough'; end if;
    update public.faction_economy set gc=gc+p_amount where faction_id=p_to_fid;
  elsif p_res='tnp' then
    update public.faction_economy set tnp=tnp-p_amount where faction_id=app.faction_id and tnp>=p_amount;
    if not found then raise exception 'not enough'; end if;
    update public.faction_economy set tnp=tnp+p_amount where faction_id=p_to_fid;
  else
    update public.faction_economy set science=science-p_amount where faction_id=app.faction_id and science>=p_amount;
    if not found then raise exception 'not enough'; end if;
    update public.faction_economy set science=science+p_amount where faction_id=p_to_fid;
  end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.economy_transfer(text,text,numeric) from public;
grant execute on function public.economy_transfer(text,text,numeric) to authenticated;

-- ── Выдача кредита (gc) ─────────────────────────────────────
create or replace function public.loan_issue(p_to_fid text, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; bowner uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if me.gc < p_amount then raise exception 'not enough'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;

  -- списание АТОМАРНО (guard в UPDATE)
  update public.faction_economy set gc=gc-p_amount where faction_id=app.faction_id and gc>=p_amount;
  if not found then raise exception 'not enough'; end if;
  update public.faction_economy set gc=gc+p_amount where faction_id=p_to_fid;

  insert into public.loans(lender_fid,lender_owner,lender_name,borrower_fid,borrower_owner,borrower_name,amount,status,note)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_amount, 'active', p_note);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.loan_issue(text,numeric,text) from public;
grant execute on function public.loan_issue(text,numeric,text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Параллельные переводы на сумму больше баланса должны частью отлететь
-- 'not enough', баланс не уходит в минус и лишний ГС не появляется.
