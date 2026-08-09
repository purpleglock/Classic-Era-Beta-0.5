-- economy_init знал только владельцев анкет: игрок, поступивший НА СЛУЖБУ
-- (faction_members), падал на 'no approved faction application' и вообще не
-- мог войти в кабинет. Экономику такому игроку создавать нечего — она уже
-- есть у державы, в которую он принят: просто отдаём её.

create or replace function public.economy_init()
returns public.faction_economy
language plpgsql security definer set search_path to 'public'
as $function$
declare
  app public.faction_applications;
  eco public.faction_economy;
  m_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;

  if not found then
    -- служащий чужой державы: своей анкеты нет, но членство есть
    m_fid := public._fm_member_fid();
    if m_fid is null then raise exception 'no approved faction application'; end if;
    m_fid := coalesce(public._su_lead_of(m_fid), m_fid);
    select * into eco from public.faction_economy where faction_id = m_fid;
    if not found then raise exception 'faction economy not initialized'; end if;
    return eco;
  end if;

  if app.faction_id is null then raise exception 'application has no faction_id'; end if;

  -- синхронизируем ресурсы колоний из данных карты (только у пустых — быстро)
  update public.colonies c
  set resources = coalesce((
    select pl->'resources'
    from public.map_systems ms, jsonb_array_elements(ms.planets) pl
    where ms.id = c.system_id
      and (case when c.planet_pid is not null
                then (pl->>'pid')::int = c.planet_pid
                else pl->>'name' = c.planet_name end) limit 1
  ), '[]'::jsonb)
  where c.faction_id = app.faction_id
    and (c.resources is null or c.resources = '[]'::jsonb);

  select * into eco from public.faction_economy where faction_id = app.faction_id;
  if found then
    -- разово догоняем недовыданное у старых фракций (до фикса): столица на карте + здания
    if not coalesce(eco.starter_fixed, false) then
      perform public._ensure_capital(app.faction_id);
      perform public._ensure_starter_buildings(app.faction_id);
      update public.faction_economy set starter_fixed = true where faction_id = app.faction_id;
    end if;
    return eco;
  end if;

  insert into public.faction_economy (faction_id, owner_id, owner_email, gc, science, tnp, last_tick, research, starter_fixed)
    values (app.faction_id, app.owner_id, app.owner_email,
            case when app.bonus_money then 500 else 0 end, 0, 0, now(),
            public._doctrine_grant_techs(app.ideology), true)   -- бесплатные техи доктрины
    returning * into eco;

  perform public._ensure_capital(app.faction_id);
  perform public._ensure_starter_buildings(app.faction_id);

  return eco;
end$function$;
