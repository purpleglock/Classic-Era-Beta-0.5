-- Активы фракции остались на прежнем владельце (передача/уния прошла мимо
-- admin_transfer), а RLS на unit_production/colonies/… пускает только
-- owner_id = auth.uid() → игрок видел пустой ростер: «корабли пропали».
-- Разовая пересинхронизация owner_id по владельцу approved-анкеты.
do $$
declare t text; n int; total int := 0;
begin
  foreach t in array array[
    'armies','colonies','colony_buildings','colony_projects','doom_guns',
    'econ_logistics','econ_relief','faction_armor_alloys','faction_economy',
    'faction_reactors','faction_turrets','faction_units','faith_membership',
    'fishing_plants','fishing_state','fleets','geosurvey_state','guardian_posts',
    'mza_ships','outpost_ships','outposts','spy_agents','spy_recruits',
    'stargaze_state','system_drone_posts','system_minefields','unit_production'
  ] loop
    execute format($f$
      update public.%I x set owner_id = fa.owner_id
        from public.faction_applications fa
       where fa.faction_id = x.faction_id
         and fa.status = 'approved'
         and fa.owner_id is not null
         and x.owner_id is distinct from fa.owner_id
    $f$, t);
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then raise notice '% → % строк', t, n; end if;
  end loop;
  raise notice 'ИТОГО: %', total;
end $$;
