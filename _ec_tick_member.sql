-- Та же болезнь, что и в economy_init: economy_tick искал казну по
-- owner_id = auth.uid(), поэтому служащий чужой державы («no economy»)
-- не проходил вход в кабинет. Резолвим державу через общий _ec_my_fid()
-- (своя анкета → членство → ведущая держава унии).

create or replace function public.economy_tick()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare fid text;
begin
  perform public.market_tick();   -- глобальный рынок: догнать суточные изменения цен
  select faction_id into fid from public.faction_economy
    where owner_id = auth.uid() order by created_at asc limit 1;
  if fid is null then fid := public._ec_my_fid(); end if;   -- участник державы
  if fid is null then raise exception 'no economy'; end if;
  return public.economy_accrue(fid);
end$function$;
