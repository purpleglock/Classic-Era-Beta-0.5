-- ════════════════════════════════════════════════════════════
-- ПЕРЕСЧЁТ ОПУБЛИКОВАННЫХ ЮНИТОВ НА КАСТОМНЫХ СПЛАВАХ
-- Применять ПОСЛЕ: _armor_alchemy.sql → _unit_publish.sql →
-- _turret_forge_units.sql → _turret_price_science.sql
-- Модель сплава сменилась (эталон класса × сила рецепта вместо прокси
-- cls.resurs), поэтому у уже опубликованных юнитов со сплавом устарели
-- hp/цена/ведомость. Трогаем ТОЛЬКО их (data ? 'armorAlloyId').
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════
update public.faction_units u
   set summary = public._cn_recompute(u.category, u.data), updated_at = now()
 where u.data ? 'armorAlloyId';
