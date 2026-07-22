-- ════════════════════════════════════════════════════════════════════════════
--  _bonds_default_cleanup.sql — дефолтные облигации больше не висят вечно.
--  1) Разовая чистка уже накопившихся дефолтных держаний (напр. «Возрождение»).
--  2) Обновление bonds_settle(): при дефолте (по купону и при погашении)
--     держания сразу удаляются из bond_holdings, как при обычном погашении.
--  ГС держатель уже потерял — исчезает только «мёртвая» запись из списка.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Разовая чистка существующих дефолтных бумаг
delete from public.bond_holdings h
  using public.bond_issues i
 where i.id = h.issue_id and i.status = 'default';

-- 2) Функция расчёта — с удалением держаний на обеих ветках дефолта
create or replace function public.bonds_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.bond_state; d int; iss record; h record;
        v_units int; v_total numeric; v_gc numeric; v_principal numeric; n int := 0;
begin
  select * into st from public.bond_state where id = 1 for update;
  if not found then
    insert into public.bond_state(id,last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.bond_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for iss in select * from public.bond_issues where status = 'open' for update loop
    select coalesce(sum(units),0) into v_units from public.bond_holdings where issue_id = iss.id;
    if v_units = 0 then
      if iss.matures_at <= now() then
        update public.bond_issues set status = 'redeemed' where id = iss.id;
      end if;
      continue;
    end if;

    select coalesce(sum(round(d * iss.face * iss.coupon_bps / 10000.0 * units)),0)
      into v_total from public.bond_holdings where issue_id = iss.id;

    select gc into v_gc from public.faction_economy where faction_id = iss.issuer_fid for update;
    if v_gc is null then continue; end if;

    if v_total > 0 then
      if v_gc < v_total then
        update public.bond_issues set status = 'default' where id = iss.id;
        begin perform public._post_life_news(
          '🏛 Дефолт по облигациям: ' || coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid)),
          format('%s не смогла обслужить купон по своему займу — выпуск объявлен дефолтным. Держатели теряют вложенное.',
                 coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid))),
          'rgba(224,104,138,0.55)', jsonb_build_array(iss.issuer_fid)); exception when others then null; end;
        delete from public.bond_holdings where issue_id = iss.id;   -- держатели потеряли вложенное — убираем мёртвые бумаги
        continue;
      end if;
      update public.faction_economy set gc = gc - v_total where faction_id = iss.issuer_fid;
      for h in select * from public.bond_holdings where issue_id = iss.id loop
        update public.faction_economy
           set gc = gc + round(d * iss.face * iss.coupon_bps / 10000.0 * h.units)
         where faction_id = h.holder_fid;
      end loop;
      n := n + 1;
    end if;

    if iss.matures_at <= now() then
      v_principal := iss.face * v_units;
      select gc into v_gc from public.faction_economy where faction_id = iss.issuer_fid for update;
      if v_gc < v_principal then
        update public.bond_issues set status = 'default' where id = iss.id;
        begin perform public._post_life_news(
          '🏛 Дефолт при погашении: ' || coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid)),
          format('%s не вернула номинал по истёкшему займу — выпуск дефолтный.',
                 coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid))),
          'rgba(224,104,138,0.55)', jsonb_build_array(iss.issuer_fid)); exception when others then null; end;
        delete from public.bond_holdings where issue_id = iss.id;   -- дефолт при погашении — номинал не вернётся, чистим бумаги
        continue;
      end if;
      update public.faction_economy set gc = gc - v_principal where faction_id = iss.issuer_fid;
      for h in select * from public.bond_holdings where issue_id = iss.id loop
        update public.faction_economy set gc = gc + iss.face * h.units where faction_id = h.holder_fid;
      end loop;
      delete from public.bond_holdings where issue_id = iss.id;
      update public.bond_issues set status = 'redeemed' where id = iss.id;
    end if;
  end loop;

  update public.bond_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'settled', n);
end$$;

revoke all on function public.bonds_settle() from public;
grant execute on function public.bonds_settle() to anon, authenticated;
