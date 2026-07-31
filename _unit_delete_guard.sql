-- ── Запрет удаления проекта, у которого есть юниты в составе/очереди ──────────
-- Симптом: игрок удаляет корабль из конструктора, а построенные экземпляры
-- остаются в unit_production и «сиротеют». Дальше всё, что читает ТТХ через
-- join на faction_units, видит пустоту:
--   • _ship_cargo(fu.data) не находит строку → груз 0 → караван считает корабль
--     ЭСКОРТОМ, а не грузовиком (жалоба 30.07);
--   • карточка состава показывает «проект больше не существует в конструкторе»;
--   • unit_scrap возвращает 0 ГС (нет summary.cost).
-- Данные проекта восстановить неоткуда, поэтому лечим причину: пока хоть один
-- юнит числится за проектом, DELETE запрещён. Хочешь убрать проект — сперва
-- спиши юниты (unit_scrap) или дождись, пока их выбьют.
--
-- Удаление идёт с клиента напрямую (constructors.js: dbDel('faction_units')),
-- RPC нет — поэтому страж именно триггером, а не проверкой в функции.

create or replace function public._faction_unit_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  select coalesce(sum(qty), 0) into n
    from public.unit_production
   where unit_id = old.id;
  if n > 0 then
    raise exception 'design in service: % units', n
      using errcode = '23503';
  end if;
  return old;
end $$;

revoke all on function public._faction_unit_delete_guard() from public;

drop trigger if exists trg_faction_unit_delete_guard on public.faction_units;
create trigger trg_faction_unit_delete_guard
  before delete on public.faction_units
  for each row execute function public._faction_unit_delete_guard();

-- Проверка осиротевших (должно оставаться только то, что уже сломано до наката):
--   select up.unit_name, up.faction_id, sum(up.qty)
--     from public.unit_production up
--     left join public.faction_units fu on fu.id = up.unit_id
--    where fu.id is null group by 1,2;
