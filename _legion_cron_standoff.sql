-- 17.08 ставим «драку на месте» в общий ход Легиона: сразу после материализации
-- ватаги. Иначе флот игрока, прилетевший в осаждённую систему, стоял бы борт к
-- борту с пиратами до следующего patience_h.
select cron.schedule('legion-engage-tick', '2-59/5 * * * *',
  $$select public.legion_losses_sweep(); select public.legion_engage_tick(); select public.legion_standoff_tick(); select public.legion_contacts_notify();$$);
