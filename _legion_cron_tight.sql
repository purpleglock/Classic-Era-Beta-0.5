-- 17.08 «НА МЕСТЕ, а там только мой флот» — карточка не врала: контакт УЖЕ
-- прилетел, но посадку делает крон раз в 15 мин, а материализацию флота — раз
-- в 15 мин со сдвигом. В худшем случае между «на месте» и появлением ватаги
-- на карте проходило до получаса пустоты, и это читается ровно как «не работает».
-- Обе операции дешёвые (пара UPDATE по горстке строк) — гоняем каждые 5 минут.

select cron.schedule('legion-contacts-scan', '*/5 * * * *',
  $$select public.legion_contacts_sweep(); select public.legion_contacts_scan();$$);

select cron.schedule('legion-engage-tick', '2-59/5 * * * *',
  $$select public.legion_losses_sweep(); select public.legion_engage_tick(); select public.legion_contacts_notify();$$);
