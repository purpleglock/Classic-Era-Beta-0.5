-- ============================================================
-- ВХОДЯЩИЕ ТАЙНЫЕ ОПЕРАЦИИ ПРОТИВ ФРАКЦИИ (оповещение жертвы)
--
-- Раньше жертва видела операции против себя ТОЛЬКО если контрразведка их
-- раскрыла (detected=true). Поэтому успешная незаметная кража казны/саботаж
-- оставались невидимыми в разделе «Разведка», хотя ущерб уже нанесён.
--
-- Эта RPC отдаёт жертве её входящие операции, соблюдая правила:
--   • detected=true  → показываем И факт, И исполнителя (раскрыт);
--   • detected=false → показываем ТОЛЬКО факт ущерба (кто — скрыт), и лишь
--     если операция реально удалась (есть последствия). Незаметные провалы
--     не светятся — следов нет.
--   • recon_* (разведка) показываем только если раскрыта (она не наносит урон).
--
-- Исполнитель (actor_fid) НИКОГДА не отдаётся клиенту для нераскрытых операций.
--
-- Требует: spy_missions, faction_applications, _fac_name (см. _economy_setup.sql).
-- Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

create or replace function public.spy_incoming()
returns table(
  id         uuid,
  op         text,
  outcome    text,
  detected   boolean,
  actor_name text,        -- имя исполнителя ТОЛЬКО при detected=true, иначе null
  result     jsonb,       -- последствия (без раскрытия исполнителя, если не раскрыт)
  created_at timestamptz,
  ready_at   timestamptz
)
language sql security definer set search_path = public as $$
  with me as (
    select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
  )
  select
    m.id, m.op, m.outcome, m.detected,
    case when m.detected then public._fac_name(m.actor_fid) else null end as actor_name,
    case when m.detected then m.result else (coalesce(m.result,'{}'::jsonb) - 'actor_name') end as result,
    m.created_at, m.ready_at
  from public.spy_missions m, me
  where m.target_fid = me.faction_id
    and m.status = 'done'
    and (
      m.detected = true
      or (m.outcome = 'success'
          and m.op in ('steal_gc','sabotage','destabilize','steal_tech'))
    )
  order by m.created_at desc
  limit 30;
$$;

revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- Проверка (необязательно):
-- select * from public.spy_incoming();
