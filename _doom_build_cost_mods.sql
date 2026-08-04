-- ═══════════════════════════════════════════════════════════════════
-- ФИКС: «Длань Неотвратимости» не возводится — «ОШИБКА: НЕДОСТАТОЧНО ГС»,
--        хотя в диалоге постройки казны хватает.
--
-- ПРИЧИНА. Клиент считает цену через ecBuildCost() = base × mods.build
-- (доктринальная скидка): 700 000 → показывает 406 000 ГС и «казна после».
-- Сервер doom_build списывает ГОЛУЮ константу _doom_const('build_gc') =
-- 700 000 без модификатора, тогда как обычная постройка (economy_build)
-- давно считает через _ec_build_cost(fid, base). При казне между 406k и
-- 700k клиент разрешает, сервер отбивает — «недостаточно ГС».
--
-- РЕШЕНИЕ: цена постройки орудия = _ec_build_cost(fid, _doom_const('build_gc')),
-- зеркало клиента. Материя (40) скидке не подлежит — как и было.
-- Идемпотентно.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.doom_build(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; eco public.faction_economy;
  used int; pending int; gc_cost numeric; matter_need numeric; have_matter numeric; res jsonb; fname text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  -- ВОРОТА: исследование «Сама неотвратимость»
  if not (coalesce(eco.research,'[]'::jsonb) ? 'pol.inevitability') then
    raise exception 'research required: pol.inevitability';
  end if;

  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects where colony_id = p_colony_id and kind='build';
  if used + pending >= coalesce(col.cells,6) then raise exception 'no free cells'; end if;

  -- ФИКС: цена с доктринальным модификатором build — зеркало ecBuildCost() на клиенте.
  gc_cost     := public._ec_build_cost(fid, public._doom_const('build_gc'));
  matter_need := public._doom_const('build_matter');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  if have_matter < matter_need then
    raise exception 'not enough programmable matter: need %, have %', matter_need, floor(have_matter);
  end if;
  if coalesce(eco.gc,0) < gc_cost then raise exception 'not enough GC'; end if;

  -- списываем ГС + материю атомарно
  res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - matter_need), true);
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', 'doomgun', p_colony_id,
     jsonb_build_object('spent_gc', gc_cost, 'spent_matter', matter_need, 'btype', 'doomgun', 'free_slots', 1),
     'Возведение Длани Неотвратимости', now() + interval '1 day');

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '☣ ВОЗВЕДЕНИЕ ОРУДИЯ СУДНОГО ДНЯ',
    coalesce(fname,'Неизвестная держава')||' закладывает «Длань Неотвратимости» в системе «'||
    coalesce(col.planet_name,'???')||'». По сектору ползёт холод: это не оружие войны — это приговор целым мирам. Да хранят нас звёзды.');

  return jsonb_build_object('ok', true, 'gc', gc_cost, 'matter', matter_need, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.doom_build(uuid) from public;
grant execute on function public.doom_build(uuid) to authenticated;
