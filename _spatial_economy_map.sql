-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · карта «бедность» — кэш просперити в system_econ
-- Выполнить ПОСЛЕ _spatial_economy1..5.sql.
-- Режим карты «бедность» читает дёшево из system_econ (без тяжёлого пересчёта
-- _system_balance_net на каждое открытие карты). Просперити пишется тиком.
-- ============================================================

alter table public.system_econ add column if not exists prosperity numeric default 1;

-- Накопление статуса + кэш просперити (зеркало _spatial_economy4, +prosperity).
create or replace function public._econ_update_status(p_fid text, p_days int)
returns void language plpgsql security definer set search_path=public as $$
declare s record; nb jsonb; cc numeric; cl numeric; w numeric; cur numeric; strn numeric; newst text; prosp numeric;
begin
  for s in select distinct c.system_id as sid from public.colonies c
           where c.faction_id = p_fid and c.system_id is not null loop
    nb := public._system_balance_net(s.sid);
    cc := coalesce((nb->'coverage'->>'c')::numeric, 1);
    cl := coalesce((nb->'coverage'->>'l')::numeric, 1);
    prosp := coalesce((nb->>'prosperity')::numeric, 1);
    w  := least(cc, cl);
    select strain into cur from public.system_econ where system_id = s.sid;
    strn := coalesce(cur, 0);
    if w < 0.4 then strn := strn + 2*p_days;
    elsif w < 0.7 then strn := strn + 1*p_days;
    elsif w >= 0.9 then strn := strn - 1*p_days;
    end if;
    strn := least(6, greatest(0, strn));
    newst := case when strn >= 4 then 'stagnation' when strn >= 2 then 'unrest' else 'ok' end;
    insert into public.system_econ(system_id, strain, status, prosperity, updated_at)
      values(s.sid, strn, newst, prosp, now())
      on conflict (system_id) do update set strain = excluded.strain, status = excluded.status,
        prosperity = excluded.prosperity, updated_at = now();
  end loop;
end$$;
revoke all on function public._econ_update_status(text,int) from public;

-- ── Разовый прогрев кэша (выполнить ОДИН раз после применения) ──
-- Заполняет system_econ для всех заселённых систем сразу, чтобы режим карты
-- «бедность» раскрасился, не дожидаясь суточного тика. Дальше обновляет тик.
insert into public.system_econ (system_id, strain, status, prosperity, updated_at)
select c.system_id, 0, nb.status, nb.prosperity, now()
from (select distinct system_id from public.colonies where system_id is not null) c
cross join lateral (
  select (b->>'status') as status, (b->>'prosperity')::numeric as prosperity
  from (select public._system_balance_net(c.system_id) as b) x
) nb
on conflict (system_id) do update
  set status = excluded.status, prosperity = excluded.prosperity, updated_at = now();
