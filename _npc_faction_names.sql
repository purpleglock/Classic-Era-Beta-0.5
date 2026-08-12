-- Имя державы: НПС-фракции карты (empire/rebels/rift) в анкетах не лежат,
-- поэтому в журнале боя они выходили как «Одна из держав». Добавляем
-- запасной источник — реестр карты.
create or replace function public._war_nm(p_fid text)
returns text language sql stable security definer set search_path=public as $function$
  select case when p_fid = public._bt_bot_fid() then public._bt_bot_name()
              else coalesce(nullif(public._fac_name(p_fid), ''),
                            nullif((select mf.name from public.map_factions mf
                                     where mf.id = p_fid), ''),
                            'Одна из держав') end;
$function$;
notify pgrst, 'reload schema';
