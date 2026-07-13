-- ── Разовый срез: округлить дробные остатки ресурсов на складах ──
-- Дробь копилась из-за фабрики товаров (×0.6 воды / ×0.4 сырья на товар)
-- в economy_accrue до фикса округления в _budget_wellbeing.sql.
-- Катить ОДИН РАЗ, порядок не важен (можно до или после перекатки accrue).
update public.faction_economy fe
set resources = (
  select coalesce(jsonb_object_agg(k, to_jsonb(round(v::numeric))), '{}'::jsonb)
  from jsonb_each_text(fe.resources) as t(k, v)
)
where fe.resources is not null
  and exists (
    select 1 from jsonb_each_text(fe.resources) as t(k, v)
    where v::numeric <> round(v::numeric)
  );
