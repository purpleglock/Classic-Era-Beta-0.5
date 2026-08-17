-- ТЕСТ 17.08: удар Легиона по «Последнему Оплоту Человечества» через 5 минут.
-- Разовый прогон рукой, в кампании не участвует: копилку сектора не трогаем,
-- контакт заводим напрямую и подрезаем расписание маршрута под срок.
-- Цель — столица «Великий трон» (sys_mr4pko8s), сектор «Далёкие территории».
-- Видимость выставляем resolved, чтобы карточка показала замысел, а не ghost.
-- Снести тест: delete from legion_contacts where kind='strike' and state='inbound';

do $$
declare kid uuid; fid text := 'fac_0fd51aa92b'; sys text := 'sys_mr4pko8s';
        sec uuid := 'f4355699-ce5a-4997-9910-41e6c271b9ba'; n int; last_at timestamptz;
begin
  kid := public._legion_contact_spawn(sec, fid, sys, 'strike', 48);
  if kid is null then raise exception 'контакт не завёлся: нет маршрута'; end if;

  -- сжимаем весь путь в 5 минут: последний узел = момент удара
  update public.legion_contacts k
     set depart_at = now(),
         arrive_at = now() + interval '5 minutes',
         route_at  = (
           select jsonb_agg(to_jsonb(
                    (now() + (interval '5 minutes'
                              * (i::numeric / greatest(1, jsonb_array_length(k.route)-1))))::text)
                  order by i)
             from generate_series(0, jsonb_array_length(k.route)-1) i)
   where k.id = kid;

  -- сеть застав тут ни при чём: тесту нужна полная осведомлённость
  insert into public.legion_sightings(contact_id, faction_id, grade, last_sys, last_sector,
                                      first_seen, last_seen, notified)
  values (kid, fid, 'resolved', sys, sec, now(), now(), false)
  on conflict (contact_id, faction_id) do update
    set grade = 'resolved', last_sys = excluded.last_sys,
        last_sector = excluded.last_sector, last_seen = now();

  raise notice 'тестовый удар заведён: % → % через 5 мин', kid, sys;
end $$;
