-- ============================================================
-- ПЕРЕСВЯЗКА МЁРТВЫХ unit_id В СОСТАВАХ (fleets / armies)
-- ------------------------------------------------------------
-- Проблема: fleets.composition и armies.composition хранят unit_id
-- дизайна СНИМКОМ (по значению). Если игрок УДАЛИЛ дизайн и создал
-- заново с тем же именем — у faction_units новый UUID, а в составе
-- остаётся старый мёртвый id. Дальше _bt_stats(id) не находит строку
-- в faction_units и возвращает NULL → в резерве боя «null HP · null урон».
-- (Правка дизайна по месту через economy_publish_unit id НЕ меняет —
--  ломает только delete + recreate.)
--
-- Решение: у записей состава с мёртвым unit_id переставить id на
-- ТЕКУЩИЙ живой дизайн той же фракции с тем же именем (берём новейший
-- по updated_at). Это разовый ремонт данных — тот же, что делался руками,
-- но сразу по всем флотам и армиям. Функцию можно гонять повторно после
-- любого будущего «удалил–пересоздал».
--
-- Выполнить целиком в Supabase → SQL Editor.
-- ============================================================

create or replace function public.relink_dead_units()
returns table(kind text, total_fixed int, entries_fixed int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  elem     jsonb;
  newcomp  jsonb;
  changed  boolean;
  fix_id   uuid;
  old_id   uuid;
  n_rows   int;
  n_ent    int;
begin
  -- ── ФЛОТЫ ────────────────────────────────────────────────
  n_rows := 0; n_ent := 0;
  for r in
    select f.id, f.faction_id, f.composition
      from public.fleets f
     where jsonb_typeof(f.composition) = 'array'
       and jsonb_array_length(f.composition) > 0
  loop
    newcomp := '[]'::jsonb;
    changed := false;
    for elem in select value from jsonb_array_elements(r.composition) loop
      old_id := nullif(elem->>'unit_id','')::uuid;
      -- unit_id живой? — оставляем как есть
      if old_id is not null
         and not exists (select 1 from public.faction_units u where u.id = old_id) then
        -- мёртвый: ищем текущий дизайн той же фракции с тем же именем
        select u.id into fix_id
          from public.faction_units u
         where u.faction_id is not distinct from r.faction_id
           and lower(u.name) = lower(coalesce(elem->>'unit_name',''))
         order by u.updated_at desc nulls last
         limit 1;
        if fix_id is not null and fix_id <> old_id then
          elem := jsonb_set(elem, '{unit_id}', to_jsonb(fix_id::text));
          changed := true;
          n_ent := n_ent + 1;
        end if;
      end if;
      newcomp := newcomp || jsonb_build_array(elem);
    end loop;
    if changed then
      update public.fleets set composition = newcomp where id = r.id;
      n_rows := n_rows + 1;
    end if;
  end loop;
  kind := 'fleets'; total_fixed := n_rows; entries_fixed := n_ent; return next;

  -- ── АРМИИ ────────────────────────────────────────────────
  n_rows := 0; n_ent := 0;
  for r in
    select a.id, a.faction_id, a.composition
      from public.armies a
     where jsonb_typeof(a.composition) = 'array'
       and jsonb_array_length(a.composition) > 0
  loop
    newcomp := '[]'::jsonb;
    changed := false;
    for elem in select value from jsonb_array_elements(r.composition) loop
      old_id := nullif(elem->>'unit_id','')::uuid;
      if old_id is not null
         and not exists (select 1 from public.faction_units u where u.id = old_id) then
        select u.id into fix_id
          from public.faction_units u
         where u.faction_id is not distinct from r.faction_id
           and lower(u.name) = lower(coalesce(elem->>'unit_name',''))
         order by u.updated_at desc nulls last
         limit 1;
        if fix_id is not null and fix_id <> old_id then
          elem := jsonb_set(elem, '{unit_id}', to_jsonb(fix_id::text));
          changed := true;
          n_ent := n_ent + 1;
        end if;
      end if;
      newcomp := newcomp || jsonb_build_array(elem);
    end loop;
    if changed then
      update public.armies set composition = newcomp where id = r.id;
      n_rows := n_rows + 1;
    end if;
  end loop;
  kind := 'armies'; total_fixed := n_rows; entries_fixed := n_ent; return next;
end$$;

revoke all on function public.relink_dead_units() from public;
-- Разовый ремонт — только администрация (запускать из SQL Editor от service role).

-- ── ЗАПУСК: чинит все сломанные флоты и армии прямо сейчас ──
select * from public.relink_dead_units();
