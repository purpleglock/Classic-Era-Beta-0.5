-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ЦЕНА АКТИВАЦИЙ НА АРЕНЕ (правка к _club_gladiators2.sql)
-- ────────────────────────────────────────────────────────────
-- ЧТО СЛОМАЛОСЬ. Ростер рев.2 раздал гладиаторам активные модули, но
-- _cn_recompute считает цену борта по КОРПУСУ, орудиям и ресурсам — вклад
-- модуля в неё копеечный. Итог: «Ноксий» — корвет за 27 480 ГС, несущий
-- ядерную ракету на 14 000 урона с 14 гексов. При бюджете драфта 825 433 ГС
-- сторона брала ТРИДЦАТЬ таких. То же с «Сагиттарием» и «Скиссором»:
-- побеждал не состав, а «самый дешёвый корпус с самой злой кнопкой».
--
-- ЧИНИМ ЛОКАЛЬНО. Глобальную модель цены не трогаем (это цена постройки для
-- всех фракций сразу). Клубу правим ТОЛЬКО его собственный ценник: цена
-- гладиатора = базовая + надбавка за каждую активацию по её боевому весу.
-- Читают её ровно два места — _fc_make_pool (запас в пуле) и battle_ready
-- (кап бюджета), оба через summary->>'cost'.
--
-- ⚠ Проекты НЕ переcоздаются: id остаются прежними, живая дуэль в forming
--   не рассыпается (её пул ссылается на эти id).
-- ⚠ Идемпотентно: базовая цена запоминается в summary.cost0 и надбавка
--   всегда считается от неё, а не от уже наценённой.
-- ЦЕПОЧКА: ПОСЛЕ _club_gladiators2.sql.
-- ════════════════════════════════════════════════════════════

-- ── §1. Вес активации в ГС ──────────────────────────────────
-- Порядок величин привязан к тому, что кнопка делает за ход: разовый бурст
-- по площади дороже баффа, бафф отряда дороже личного.
create or replace function public._fc_act_price(k text) returns numeric
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'nuke',   160000,   -- 14000 по площади через полдоски: дороже любого корпуса
    'torpedo', 90000,   -- 9000 по площади
    'tartarus',60000,   -- три дебаффа разом, ход цели вычеркнут
    'pboost',  40000,   -- +50% урона всему строю
    'siege',   40000,   -- урон ×2, рубеж ×1.25
    'hell',    35000,   -- по каждому врагу в двух гексах
    'broadside',35000,
    'aboost',  35000,   -- −35% входящего всему строю
    'ram',     32000,
    'storm',   30000,
    'rupture', 30000,
    'stasis',  30000,
    'sammo',   30000,
    'rapid',   30000,
    'hard',    30000,
    'salvo',   28000,
    'cloak',   28000,
    'disrupt', 28000,
    'amp',     25000,
    'blind',   25000,
    'tractor', 25000,
    'wboost',  25000,
    'wbreak',  25000,
    'pdup',    25000,
    'reboot',  25000,
    'blink',   22000,
    'drones',  22000,
    'drain',   22000,
    'energy',  18000)->>k)::numeric, 25000);
$$;
grant execute on function public._fc_act_price(text) to anon, authenticated, service_role;

-- ── §2. Переоценка ростера ──────────────────────────────────
do $$
declare r record; base numeric; add numeric;
begin
  for r in select id, summary from public.faction_units where faction_id = 'club' loop
    -- базовая цена: первый прогон запоминает её, следующие берут запомненную
    base := coalesce((r.summary->>'cost0')::numeric, (r.summary->>'cost')::numeric, 0);
    select coalesce(sum(public._fc_act_price(a->>'k')), 0) into add
      from jsonb_array_elements(public._bt_acts_of(r.id)) a;
    update public.faction_units
       set summary = summary || jsonb_build_object('cost0', base, 'cost', round(base + add))
     where id = r.id;
  end loop;
end $$;

-- ── §3. Множитель бюджета под новый ценник ──────────────────
-- Медиана ростера выросла (кнопки теперь стоят денег), поэтому множитель
-- опускаем: цель прежняя — на доску выходит эскадра, а не один борт и не
-- тридцать ядерных корветов.
create or replace function public._fc_pool_mult()
returns numeric language sql immutable as $$ select 10::numeric $$;

-- ── §4. Живая дуэль в forming — по новому ценнику ───────────
-- Бюджет и запасы в резерве считались до переоценки: без этого сторона,
-- успевшая войти в дуэль вчера, играет по старым правилам.
do $$
declare b record; med numeric; nb numeric;
begin
  select percentile_cont(0.5) within group (order by (summary->>'cost')::numeric)
    into med from public.faction_units where faction_id = 'club';
  nb := greatest(1, round(public._fc_pool_mult() * greatest(med, 1)));

  for b in select id from public.battles where kind = 'duel' and status = 'forming' loop
    update public.battles set duel_budget = nb where id = b.id;
    -- запас каждого проекта в резерве = сколько влезет в бюджет (кап доски)
    update public.fleets f
       set composition = (
         select coalesce(jsonb_agg(c || jsonb_build_object('qty', q.qty)), '[]'::jsonb)
           from jsonb_array_elements(f.composition) c
           cross join lateral (
             select least(public._bt_cap(), greatest(1, floor(nb / greatest(
                      coalesce((select (fu.summary->>'cost')::numeric
                                  from public.faction_units fu
                                 where fu.id = (c->>'unit_id')::uuid), 1), 1))::int)) as qty
           ) q)
      where f.id in (select fleet_id from public.battle_fleets where battle_id = b.id);
    perform public._bt_log(b.id, format(
      '⚖ Ценник арены пересчитан: активные модули теперь стоят денег. Новый бюджет драфта — %s ГС.',
      nb::bigint));
  end loop;
end $$;
