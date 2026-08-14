-- ══════════════════════════════════════════════════════════════
-- ЧЬЯ ЭТО ГРЯДКА — ВИДНО С ОРБИТЫ
-- ══════════════════════════════════════════════════════════════
-- ⚠️ ЯЧЕЙКА ЗНАЛА СВОЮ ДЕРЖАВУ, НО НЕ НАЗЫВАЛА ЕЁ. `garden_get` отдавал у
-- плантации только `fid` и `mine` — на сцене чужая грядка отличалась от своей
-- лишь тем, что бледнее, а КТО её держит, узнавали, ткнув в неё и получив
-- «Чужая плантация. Смотреть можно, трогать — нет». Сад многолюдный (см.
-- garden_ping): сосед должен читаться до касания.
-- Добавляем к плантации имя, цвет и герб державы — над ячейкой встанет флаг.
--
-- Цепочка: после _garden_sprouts.sql (перекрывает garden_get из него).
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_plots jsonb; v_lands jsonb; v_temple text; v_spr jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  v_temple := public._g_temple_sys();

  perform public._g_tick(pl.id)
     from public.garden_plants pl
    where pl.faction_id = fid and not pl.harvested;

  -- Держава ячейки. Имя и цвет — из реестра карты, герб — из анкеты: то же
  -- добро, что уже светится в дипломатии и на кораблях, ничего приватного.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'sys', g.sys, 'cell', g.cell, 'land', g.land,
      'fid', g.faction_id, 'mine', (g.faction_id = fid),
      'fnm',  mf.name, 'fcol', coalesce(mf.color, fa.color), 'fher', fa.herald_url,
      'plant', case when p.id is null then null else jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'res', p.res,
        'water', round(p.water), 'feed', round(p.feed), 'weeds', round(p.weeds),
        'care',  round(public._g_care(p), 3),
        'ripe',  (now() >= p.ripe_at),
        'left',  greatest(0, floor(extract(epoch from (p.ripe_at - now()))))::int)
      end)), '[]'::jsonb) into v_plots
    from public.garden_plots g
    left join public.garden_plants p on p.plot_id = g.id and not p.harvested
    left join public.map_factions mf on mf.id = g.faction_id
    left join public.faction_applications fa on fa.faction_id = g.faction_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'sys', s.id, 'name', s.name, 'land', public._g_land(fid, s.id),
      'cells', public._g_cells(s.id), 'seeds', public._g_seeds(s.id))), '[]'::jsonb)
    into v_lands
    from public.map_systems s
   where s.id = v_temple
      or exists (select 1 from public.colonies c
                  where c.system_id = s.id and c.faction_id = fid);

  select coalesce(jsonb_agg(jsonb_build_object(
      'res', gs.res, 'rar', gs.rar, 'icon', gs.icon, 'qty', gs.qty)
      order by gs.rar desc, gs.res), '[]'::jsonb)
    into v_spr
    from public.garden_sprouts gs
   where gs.faction_id = fid and gs.qty > 0;

  return jsonb_build_object(
    'fid', fid, 'temple', v_temple,
    'plots', v_plots, 'lands', v_lands, 'sprouts', v_spr,
    'seed_ichor', coalesce((select seed from public.fishing_state where faction_id = fid), 0),
    'const', jsonb_build_object(
      'till_gc',   public._g_const('till_gc'),
      'feed_gc',   public._g_const('feed_gc'),
      'seed_gc',   public._g_const('seed_ichor_gc'),
      'ichor_cap', public._g_const('ichor_cap'),
      'plot_cap',  public._g_const('plot_cap')));
end$$;
revoke all on function public.garden_get() from public, anon;
grant execute on function public.garden_get() to authenticated;
