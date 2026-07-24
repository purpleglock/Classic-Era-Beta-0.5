-- ════════════════════════════════════════════════════════════════════
-- КОРНЕВОЙ ФИКС КЛАССА «FK colony_buildings_colony_id_fkey» (23503).
--
-- Причина всех повторов: public.colony_projects.colony_id НЕ имеет внешнего
-- ключа на colonies. Когда колония удаляется (снос/потеря/захват/реворк),
-- её незавершённые build-проекты ОСТАЮТСЯ висеть. Позже тик экономики
-- завершает такой проект и делает insert в colony_buildings с colony_id
-- мёртвой колонии → нарушение FK → весь тик откатывается →
-- «Не удалось загрузить экономику».
--
-- Точечные guard'ы в функциях лечат симптом. Этот файл убирает ПРИЧИНУ на
-- уровне схемы: FK ... ON DELETE CASCADE. После него удаление колонии само
-- сносит её проекты — сироте физически неоткуда взяться.
--
-- Применять в Supabase SQL Editor одним куском. Идемпотентно.
-- ════════════════════════════════════════════════════════════════════

-- 1) Снести уже существующих сирот (иначе ADD CONSTRAINT не пройдёт валидацию).
--    Только build/slot/habitat реально ссылаются на colony_id; terraform
--    использует system_id и обычно имеет colony_id = NULL (NULL FK не мешает).
delete from public.colony_projects cp
where cp.colony_id is not null
  and not exists (select 1 from public.colonies c where c.id = cp.colony_id);

-- 2) Заодно зачистим уже осиротевшие здания (если такие успели вставиться
--    до применения фикса) — их колонии больше нет.
delete from public.colony_buildings cb
where not exists (select 1 from public.colonies c where c.id = cb.colony_id);

-- 3) Повесить внешний ключ с каскадом. Пересоздаём, чтобы миграция была
--    идемпотентной и не падала при повторном запуске.
alter table public.colony_projects
  drop constraint if exists colony_projects_colony_id_fkey;

alter table public.colony_projects
  add constraint colony_projects_colony_id_fkey
  foreign key (colony_id) references public.colonies(id) on delete cascade;

-- Проверка после применения — обе должны вернуть 0:
--   select count(*) from public.colony_projects cp
--     where cp.colony_id is not null
--       and not exists (select 1 from public.colonies c where c.id = cp.colony_id);
--   select count(*) from public.colony_buildings cb
--     where not exists (select 1 from public.colonies c where c.id = cb.colony_id);
