-- 17.08 «таймер идёт, нихуя не происходит».
-- Фон (щупальце за cost_bg=8) уходил каждые bg_gap_h=5 ч = 1.6 копилки/час,
-- а самый жирный сектор копит 1.52/час. Замысел strike (48) не набирался
-- НИКОГДА: копилка вечно болталась около bg_floor=24. За двое суток — только
-- probe'ы силой 8, которые при пустой системе идут веткой грабежа (угон 4% и
-- раствориться) и на карте не видны. Последний strike — 15.08.
--
-- Правка: фон платит только с ИЗЛИШКА над ценой замысла (pressure >= cost + cost_bg),
-- то есть накопление на strike он сорвать не может в принципе; и реже (8 ч).

create or replace function public._legion_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'cost_probe'   then 12
    when 'cost_blind'   then 26
    when 'cost_strike'  then 48
    -- фоновое щупальце: дешевле обычного probe и НЕ конкурирует с замыслом
    when 'cost_bg'      then 8
    -- не чаще раза в N часов на сектор, иначе фон превращается в ковёр
    when 'bg_gap_h'     then 8
    -- ⚠ ЛЕГАСИ: фиксированный пол снят, порог фона считается от цены замысла
    -- (см. legion_campaign_tick). Оставлено, чтобы не ломать сторонние вызовы.
    when 'bg_floor'     then 24
    when 'max_inflight' then 3
    when 'aggro_bite'   then 12
    -- сила, начиная с которой отряд встаёт на карту даже в пустой системе
    when 'stand_from'   then 40
    else 0 end
$$;

create or replace function public.legion_campaign_tick()
returns jsonb language plpgsql security definer as $$
declare s record; p numeric; kind text; cost numeric; t record; fatn numeric;
        kid uuid; live int; made int := 0; bg int := 0; log jsonb := '[]'::jsonb;
        eyes boolean; fired boolean;
begin
  for s in select lp.sector_id, lp.pressure, sec.name,
                  greatest(1, coalesce(array_length(sec.system_ids,1),1)) nsys
             from public.legion_pressure lp
             join public.map_sectors sec on sec.id = lp.sector_id
            where lp.pressure >= public._legion_const('cost_bg')
            order by lp.pressure desc loop

    select count(*) into live from public.legion_contacts
     where sector_id = s.sector_id and state = 'inbound';
    if live >= public._legion_const('max_inflight') then continue; end if;

    p := s.pressure;
    fatn := public._legion_sector_fat(s.sector_id) / s.nsys;
    select exists (
      select 1 from public.outposts o
       where o.system_id in (select unnest(system_ids) from public.map_sectors
                              where id = s.sector_id)
         and o.mode in ('recon','depot')
         and public._outpost_crew_k(o.crew, o.mode) >= 0.5) into eyes;

    if    fatn >= 6            then kind := 'strike';
    elsif fatn >= 3 and eyes   then kind := 'blind';
    else                            kind := 'probe';
    end if;
    cost := public._legion_const('cost_' || kind);
    fired := false;

    -- ── ЗАМЫСЕЛ ──
    if p >= cost then
      select * into t from public._legion_targets(s.sector_id, kind) limit 1;
      if t.sys is null and kind <> 'probe' then
        kind := 'probe'; cost := public._legion_const('cost_probe');
        select * into t from public._legion_targets(s.sector_id, kind) limit 1;
      end if;
      if t.sys is not null and public._legion_spend(s.sector_id, cost) then
        kid := public._legion_contact_spawn(s.sector_id, t.fid, t.sys, kind, cost);
        if kid is not null then
          fired := true; made := made + 1;
          log := log || jsonb_build_array(jsonb_build_object(
            'sector', s.name, 'kind', kind, 'cost', cost,
            'target_sys', t.sys, 'target_fid', t.fid, 'score', t.score));
        end if;
      end if;
    end if;

    -- ── ФОН ──
    -- Щупальце идёт, только если сектор копит на что-то КРУПНОЕ (иначе probe
    -- и есть его замысел, дублировать незачем) и копилка уже ПЕРЕКРЫВАЕТ цену
    -- замысла — фон платит с излишка. ⚠ Раньше здесь стоял фиксированный пол
    -- bg_floor=24: при цене strike=48 фон снимал по 8 каждые 5 ч (1.6/час) при
    -- накоплении 1.5/час, и удар не собирался никогда.
    if not fired and kind <> 'probe'
       and (select pressure from public.legion_pressure where sector_id = s.sector_id)
           >= cost + public._legion_const('cost_bg')
       and not exists (select 1 from public.legion_contacts k
                        where k.sector_id = s.sector_id and not k.reprisal
                          and k.depart_at > now()
                              - (public._legion_const('bg_gap_h') || ' hours')::interval)
    then
      select * into t from public._legion_targets(s.sector_id, 'probe') limit 1;
      if t.sys is not null
         and public._legion_spend(s.sector_id, public._legion_const('cost_bg')) then
        kid := public._legion_contact_spawn(s.sector_id, t.fid, t.sys, 'probe',
                                            public._legion_const('cost_bg'));
        if kid is not null then
          bg := bg + 1;
          log := log || jsonb_build_array(jsonb_build_object(
            'sector', s.name, 'kind', 'probe/фон', 'cost', public._legion_const('cost_bg'),
            'target_sys', t.sys, 'target_fid', t.fid));
        end if;
      end if;
    end if;
  end loop;

  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'launched', made, 'background', bg, 'log', log);
end $$;
