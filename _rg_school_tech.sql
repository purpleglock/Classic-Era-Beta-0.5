-- ════════════════════════════════════════════════════════════
-- РЕАКТОРНАЯ ВЕРФЬ: ШКОЛЫ ЗА ИССЛЕДОВАНИЯ
-- ────────────────────────────────────────────────────────────
-- До этого верфь не гейтилась ничем: с первого дня фракции была доступна
-- аннигиляция наравне с РИТЭГом, и вся «прогрессия» школ (capK 1.20 → 3.00)
-- ничего не стоила. Теперь КАЖДАЯ школа — узел дерева:
--
--   rg.school.ritag   6 ОН   корень (стартовая, выдана бэкфиллом)
--   rg.school.yaeu   20 ОН   ← ritag  (тоже бэкфилл: раньше была даром)
--   rg.school.mgd    55 ОН   ← yaeu
--   rg.school.tyar  120 ОН   ← yaeu
--   rg.school.amu   300 ОН   ← tyar
--   rg.school.kvg   480 ОН   ← tyar + mgd
--
-- Проверка — на СЕРВЕРЕ, в reactor_upsert (клиент лишь прячет замки): иначе
-- школу подменяют из консоли, как это было с экономикой (client-write RLS hole).
-- Зеркало клиента: EC_REACTOR_SCHOOLS в economy.js + RG_SCHOOL_TECH в reactor_gen.js.
--
-- Порядок применения: ПОСЛЕ _reactor_forge.sql (нужны faction_reactors и
-- reactor_upsert) и ПОСЛЕ _research_queue.sql (нужен tech_nodes).
-- ⚠ Функция reactor_upsert пересоздаётся ЦЕЛИКОМ — если её правили после
--   _reactor_forge.sql, сверить тело с живым дампом перед накатом.
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §1. Каталог узлов ────────────────────────────────────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('rg.school.ritag',   6, '[]'::jsonb),
  ('rg.school.yaeu',   20, '["rg.school.ritag"]'::jsonb),
  ('rg.school.mgd',    55, '["rg.school.yaeu"]'::jsonb),
  ('rg.school.tyar',  120, '["rg.school.yaeu"]'::jsonb),
  ('rg.school.amu',   300, '["rg.school.tyar"]'::jsonb),
  ('rg.school.kvg',   480, '["rg.school.tyar","rg.school.mgd"]'::jsonb)
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── §2. Бэкфилл «не с нуля» ──────────────────────────────────
-- Раньше верфь была открыта целиком, поэтому:
--   • ВСЕМ существующим фракциям даром идут ritag+yaeu (корни ветки);
--   • школа, на которой УЖЕ собран хоть один реактор фракции, засчитывается
--     изученной — иначе редактирование своей же установки упрётся в замок.
with want as (
  select e.faction_id, unnest(array['rg.school.ritag','rg.school.yaeu']) as node
    from public.faction_economy e
  union
  select r.faction_id, 'rg.school.' || (r.cfg->>'school')
    from public.faction_reactors r
   where r.faction_id is not null and nullif(r.cfg->>'school','') is not null
), agg as (
  select w.faction_id, array_agg(distinct w.node) as nodes
    from want w
   where exists (select 1 from public.tech_nodes t where t.node_id = w.node)
   group by w.faction_id
)
update public.faction_economy e
   set research = coalesce(e.research, '[]'::jsonb) || coalesce((
         select jsonb_agg(to_jsonb(n))
           from unnest(a.nodes) n
          where not (coalesce(e.research, '[]'::jsonb) ? n)), '[]'::jsonb)
  from agg a
 where a.faction_id = e.faction_id;

-- ── §3. Проверка доступа к школе ─────────────────────────────
-- Отдельная функция, чтобы тем же ключом гейтить и будущие места (например,
-- покупку чужого реактора на рынке).
create or replace function public._rg_school_tech(p_school text)
returns text language sql immutable as $$
  select 'rg.school.' || coalesce(nullif(p_school,''), 'ritag');
$$;
grant execute on function public._rg_school_tech(text) to authenticated;

-- Право фракции p_fid ковать школу p_school. p_fid is null (стафф без своей
-- фракции — тест/модерация) → разрешено.
create or replace function public._rg_school_ok(p_fid text, p_school text)
returns boolean language plpgsql stable as $$
declare res jsonb;
begin
  if p_fid is null then return true; end if;
  select coalesce(research, '[]'::jsonb) into res
    from public.faction_economy where faction_id = p_fid;
  return coalesce(res, '[]'::jsonb) ? public._rg_school_tech(p_school);
end$$;
grant execute on function public._rg_school_ok(text,text) to authenticated;

-- ── §4. reactor_upsert с гейтом школы ────────────────────────
-- Базовое тело — из _reactor_forge.sql §6, добавлена только проверка школы
-- ПОСЛЕ нормализации конфига (нормализация могла сама сменить школу под класс).
create or replace function public.reactor_upsert(
  p_reactor_id uuid, p_name text, p_cfg jsonb,
  p_faction_id text, p_faction_name text, p_faction_color text
) returns public.faction_reactors language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_cfg jsonb; v_st jsonb; v_car text[]; v_why text;
  row public.faction_reactors;
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
  v_school text; v_ab text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'empty name'; end if;
  if not staff and my_fid is null then raise exception 'no approved faction'; end if;
  if p_faction_id is not null and not staff and p_faction_id is distinct from my_fid then
    raise exception 'no rights for faction';
  end if;

  v_cfg := public._rg_norm(coalesce(p_cfg,'{}'::jsonb));

  -- Школа — исследование. Гейтим по фракции, от имени которой идёт ковка:
  -- стафф без фракции проходит насквозь (my_fid = null).
  v_school := v_cfg->>'school';
  if not public._rg_school_ok(coalesce(p_faction_id, my_fid), v_school) then
    v_ab := coalesce(public._rg_dict()->'schools'->v_school->>'ab', v_school);
    raise exception 'школа «%» не изучена: нужна технология «%»', v_ab, public._rg_school_tech(v_school);
  end if;

  v_st  := public._rg_stats(v_cfg);
  v_why := public._rg_fit(v_cfg, v_st);
  if v_why <> '' then raise exception 'установку не примет носитель: %', v_why; end if;
  v_car := public._rg_carriers(v_cfg, v_st);

  if p_reactor_id is null then
    insert into public.faction_reactors(owner_id, faction_id, faction_name, faction_color,
                                        name, cfg, stats, carriers)
    values (uid, p_faction_id, p_faction_name, p_faction_color, left(p_name,48), v_cfg, v_st, v_car)
    returning * into row;
  else
    update public.faction_reactors
       set name = left(p_name,48), cfg = v_cfg, stats = v_st, carriers = v_car,
           faction_name  = coalesce(p_faction_name, faction_name),
           faction_color = coalesce(p_faction_color, faction_color),
           updated_at = now()
     where id = p_reactor_id
       and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid))
    returning * into row;
    if row.id is null then raise exception 'reactor not found or forbidden'; end if;
  end if;
  return row;
end;
$$;
grant execute on function public.reactor_upsert(uuid,text,jsonb,text,text,text) to authenticated;
