-- ════════════════════════════════════════════════════════════════════════════
--  corp_recompose — смена состава предприятий организации за фиксированную плату.
--  Применять в Supabase → SQL Editor (идемпотентно). Зависит от:
--    _exchange_corps.sql (corporations / corp_buildings / colony_buildings,
--    _corp_daily_net, _ec_my_fid, current_user_banned, faction_economy).
--
--  Что делает: учредитель организации платит 10 000 ГС и задаёт НОВЫЙ набор
--  своих построек. Старый состав очищается, добавляются только переданные
--  постройки (мои и не занятые другой организацией). Котировка-ориентир
--  пересчитывается по новому доходу. Без модерации — состав механический
--  (реальные постройки), не контент.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.corp_recompose(p_corp uuid, p_buildings jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; bid uuid; n_set int := 0; fee numeric := 10000;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  -- организация должна быть моей
  perform 1 from public.corporations where id = p_corp and faction_id = fid;
  if not found then raise exception 'not your corporation'; end if;

  -- плата 10 000 ГС из казны
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < fee then raise exception 'not enough GC'; end if;
  update public.faction_economy set gc = gc - fee where faction_id = fid;

  -- заменяем состав: убираем все текущие постройки этой организации
  delete from public.corp_buildings where corp_id = p_corp;

  -- добавляем выбранные (только мои и ещё не в другой организации)
  if p_buildings is not null then
    for bid in select (jsonb_array_elements_text(p_buildings))::uuid loop
      perform 1 from public.colony_buildings where id = bid and faction_id = fid;
      if not found then continue; end if;
      perform 1 from public.corp_buildings where building_id = bid;
      if found then continue; end if;
      insert into public.corp_buildings(building_id, corp_id) values (bid, p_corp);
      n_set := n_set + 1;
    end loop;
  end if;

  -- пересчёт котировки-ориентира (P/E≈20 от чистой выручки с синергией)
  update public.corporations
     set share_price = round(public._corp_daily_net(p_corp) * 20.0 / greatest(total_shares,1), 2)
   where id = p_corp;

  return jsonb_build_object('ok', true, 'buildings', n_set, 'fee', fee,
    'gc', (select gc from public.faction_economy where faction_id = fid));
end$$;

revoke all  on function public.corp_recompose(uuid,jsonb) from public;
grant execute on function public.corp_recompose(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- select corp_recompose('<corp_id>'::uuid,
--   (select jsonb_agg(id) from colony_buildings where faction_id='<мой fid>' limit 3));
