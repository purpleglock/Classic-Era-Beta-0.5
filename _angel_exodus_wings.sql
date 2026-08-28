-- ════════════════════════════════════════════════════════════
-- ИСХОД: КРЫЛЬЯ НЕ ЖДУТ НАД ЧУЖИМИ МИРАМИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_exodus.sql. Идемпотентно.
--
-- ЧТО НАШЛОСЬ НА ПРОВЕРКЕ. Штатное сопровождение подтягивает крылья ТОЛЬКО
-- по прибытии тела («сопровождение не обгоняет сопровождаемого»), а ковчег
-- идёт к Храму несколько часов по трассам. Всё это время 31 крыло стоит там,
-- где их застал приказ, — над колониями игроков. Стрелять они уже не могут,
-- но «оно ушло» и «над моей планетой висит его крыло» — это разные новости,
-- и вторая перебивает первую.
--
-- В ПОХОДЕ ПРАВИЛО ДРУГОЕ: точка сбора — Храм, а не текущее место тела.
-- Крылья снимаются сразу и ждут ковчег ТАМ.
-- ════════════════════════════════════════════════════════════
create or replace function public._angel_pilgrim_follow()
returns int language plpgsql security definer set search_path=public as $$
declare a record; here text; dest text; f record; n int := 0;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.fleet_id is null then return 0; end if;
  select fl.system_id into here from public.fleets fl where fl.id = a.fleet_id;
  -- тело в пути — сбор всё равно у Храма, а не там, где крыло застало приказ
  dest := coalesce(here, public._angel_temple());

  -- ⚠️ НЕ ТОЛЬКО РЕЕСТР КРЫЛЬЕВ. На проверке у него нашлось ~370 бортов, а в
  -- `angel_guard` числится 31: остальное — то, что настроила его верфь, и оно
  -- так и стояло над колониями (102 борта над системой, которую он ел).
  -- «Все силы кризиса» — это ВСЕ его флоты, а не только оформленные крылья.
  for f in select fl.id from public.fleets fl
            where fl.faction_id = a.faction_id
              and fl.id is distinct from a.fleet_id      -- ковчег идёт своим ходом
              and fl.system_id is distinct from dest
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;
    update public.fleets
       set system_id = dest, status = 'idle', from_sys = null, dest_sys = null,
           depart_at = null, arrive_at = null, route = null, route_at = null
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public._angel_pilgrim_follow() from public;

notify pgrst, 'reload schema';
