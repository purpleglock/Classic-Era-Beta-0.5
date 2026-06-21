-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 7 — СМЯГЧЕНИЕ + ВЫПИЛ «ПОТРЕБЛЕНИЯ»
-- Выполнить ПОСЛЕДНИМ: после _spatial_economy1..5.sql, _spatial_economy_map.sql
-- и _poverty.sql. Надстройка-починка.
--
-- ГЛАВНОЕ: категории «ПОТРЕБЛЕНИЕ» (ТНП) В ИГРЕ НЕТ — её нечем было закрыть,
--   и именно она роняла доход в пол. Здесь она УБРАНА ПОЛНОСТЬЮ из экономики.
--   Остаются реальные оси: ⛏ сырьё (шахты), 🏭 товары (фабрики), 👷 труд (население).
--   ПРОСПЕРИТИ ТЕПЕРЬ ЗАВИСИТ ТОЛЬКО ОТ ТРУДА = население ÷ плотность застройки.
--   Один понятный рычаг: меньше построек на население — богаче. Столица стартует
--   богатой (много населения, мало застройки), при плотной застройке доход мягко
--   проседает. Сырьё/товары остаются справочными шкалами + лёгкая (±15%) товарная
--   премия фабрикам — на доход почти не влияют.
--
-- СМЯГЧЕНИЕ: просперити в узкой полосе 0.85..1.30 (обвалов нет); столица иммунна
--   (всегда богата/спокойна); отток населения символический (пол 0.85), восстания
--   редкие и с малым ущербом; кэш prosperity для карты восстановлен.
--
-- Переопределяет: _building_vector (co/ci → 0), _system_is_capital(new),
--   _econ_adjust, _system_balance, _system_balance_net, _econ_update_status.
--   economy_accrue НЕ трогаем — он их вызывает.
-- ============================================================

alter table public.system_econ add column if not exists prosperity numeric default 1;  -- кэш для карты

-- ── Паспорт домика БЕЗ потребления (co=0, ci=0) ─────────────
--   p_tnp оставлен в сигнатуре для совместимости вызовов, но игнорируется.
create or replace function public._building_vector(p_btype text, p_slots numeric, p_tnp boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'ro', ro*s, 'go', go*s, 'co', 0,
    'ri', ri*s, 'gi', gi*s, 'ci', 0, 'l', l*s)
  from (select
    case p_btype when 'mining' then 3 else 0 end as ro,
    case p_btype when 'factory' then 3 else 0 end as go,
    case p_btype when 'factory' then 2
                 when 'military_factory' then 2 when 'shipyard' then 3 else 0 end as ri,
    case p_btype when 'science' then 1 when 'training' then 1 when 'intel' then 1
                 when 'military_factory' then 1 when 'shipyard' then 2 else 0 end as gi,
    case p_btype
      when 'mining' then 1 when 'factory' then 2 when 'trade' then 1 when 'market' then 1
      when 'warehouse' then 0.5 when 'science' then 2 when 'training' then 2 when 'intel' then 1
      when 'military_factory' then 2 when 'shipyard' then 3 when 'temple' then 1 else 0 end as l,
    coalesce(p_slots, 0)::numeric as s
  ) v
$$;
revoke all on function public._building_vector(text,numeric,boolean) from public;
grant execute on function public._building_vector(text,numeric,boolean) to anon, authenticated;

-- ── Хелпер: система содержит столичную колонию? ─────────────
create or replace function public._system_is_capital(p_system_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.colonies
    where system_id = p_system_id and coalesce(is_capital, false));
$$;
revoke all on function public._system_is_capital(text) from public;
grant execute on function public._system_is_capital(text) to anon, authenticated;

-- ── Корректировка просперити: сектор + статус + помощь/восстание + СТОЛИЦА ──
create or replace function public._econ_adjust(p_system_id text, p_prosp numeric, p_status text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare smod numeric; persist text; fstatus text; pr numeric; rv timestamptz; is_cap boolean;
begin
  is_cap := public._system_is_capital(p_system_id);
  select case when econ_until is not null and econ_until < now() then 1 else coalesce(econ_mod,1) end
    into smod from public.map_sectors where p_system_id = any(system_ids) limit 1;
  smod := coalesce(smod, 1);
  select status, revolt_until into persist, rv from public.system_econ where system_id = p_system_id;
  fstatus := coalesce(persist, p_status);
  pr := p_prosp * smod;
  if not is_cap then
    if fstatus = 'stagnation' then pr := least(pr, 0.90);       -- мягкий потолок (было 0.40)
    elsif fstatus = 'unrest' then pr := pr * 0.95; end if;       -- лёгкое снижение (было 0.85)
    if rv is not null and rv > now() then pr := pr * 0.95; end if; -- штраф восстания (было 0.80)
  end if;
  pr := pr + public._poverty_relief_prosp(p_system_id);          -- помощь (поверх потолка)
  if is_cap then pr := pr + 0.10; fstatus := 'ok'; end if;        -- столица: богата и спокойна
  pr := round(least(1.30, greatest(0.85, pr)), 3);
  return jsonb_build_object('prosperity', pr, 'status', fstatus);
end$$;
revoke all on function public._econ_adjust(text,numeric,text) from public;
grant execute on function public._econ_adjust(text,numeric,text) to anon, authenticated;

-- ── Баланс системы (raw): просперити ТОЛЬКО от труда (плотности) ──
create or replace function public._system_balance(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; v jsonb;
  sup_r numeric:=0; sup_g numeric:=0;
  dem_r numeric:=0; dem_g numeric:=0;
  lab_d numeric:=0; pop numeric:=0; lab_s numeric;
  cov_r numeric; cov_g numeric; cov_l numeric;
  pr_r numeric; pr_g numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  -- эффективное население = ёмкость × доля заселённости (миграция, срез 6)
  select coalesce(sum(cells * coalesce(pop_mult,1)),0) into pop
    from public.colonies where system_id = p_system_id;

  for r in
    select cb.btype, cb.slots_open
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where c.system_id = p_system_id
  loop
    v := public._building_vector(r.btype, r.slots_open, false);
    sup_r := sup_r + (v->>'ro')::numeric; sup_g := sup_g + (v->>'go')::numeric;
    dem_r := dem_r + (v->>'ri')::numeric; dem_g := dem_g + (v->>'gi')::numeric;
    lab_d := lab_d + (v->>'l')::numeric;
  end loop;

  lab_s := pop * 1;                  -- население даёт рабочие руки

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  -- цены: мягкая премия/скидка ±15% (товары → лёгкая премия фабрикам)
  pr_r := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_r))),3);
  pr_g := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_g))),3);

  -- ПРОСПЕРИТИ = только труд (плотность застройки), узкая полоса 0.85..1.30
  welfare := least(1.5, greatest(0, cov_l));
  prosperity := round(least(1.30, greatest(0.85, 0.85 + 0.30*welfare)),3);
  if cov_l < 0.3 then st := 'stagnation';
  elsif cov_l < 0.5 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', pop,
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance(text) from public;
grant execute on function public._system_balance(text) to anon, authenticated;

-- ── Баланс NET: + пассивный спилловер сырья/товаров от соседей (труд локален) ──
create or replace function public._system_balance_net(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  raw jsonb; src jsonb; ng record;
  sup_r numeric; sup_g numeric;
  dem_r numeric; dem_g numeric;
  lab_s numeric; lab_d numeric;
  sp_r numeric:=0; sp_g numeric:=0;
  nsurp_r numeric:=0; nsurp_g numeric:=0;
  spill numeric;
  v_fac text;
  cov_r numeric; cov_g numeric; cov_l numeric;
  pr_r numeric; pr_g numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  raw := public._system_balance(p_system_id);
  sup_r := (raw->'supply'->>'r')::numeric; sup_g := (raw->'supply'->>'g')::numeric;
  dem_r := (raw->'demand'->>'r')::numeric; dem_g := (raw->'demand'->>'g')::numeric;
  lab_s := (raw->'labor'->>'supply')::numeric; lab_d := (raw->'labor'->>'demand')::numeric;

  -- ПАССИВНЫЙ СПИЛЛОВЕР: соседи той же фракции гасят остаточный дефицит сырья/товаров
  select faction into v_fac from public.map_systems where id = p_system_id;
  if v_fac is not null then
    for ng in
      select case when h.a_id = p_system_id then h.b_id else h.a_id end as nid
      from public.map_hyperlanes h
      where h.a_id = p_system_id or h.b_id = p_system_id
    loop
      if (select faction from public.map_systems where id = ng.nid) is distinct from v_fac then continue; end if;
      src := public._system_balance(ng.nid);
      nsurp_r := nsurp_r + greatest(0, (src->'supply'->>'r')::numeric - (src->'demand'->>'r')::numeric);
      nsurp_g := nsurp_g + greatest(0, (src->'supply'->>'g')::numeric - (src->'demand'->>'g')::numeric);
    end loop;
    if dem_r > sup_r then spill := least((dem_r-sup_r)*0.6, nsurp_r*0.15); sup_r := sup_r + spill; sp_r := spill; end if;
    if dem_g > sup_g then spill := least((dem_g-sup_g)*0.6, nsurp_g*0.15); sup_g := sup_g + spill; sp_g := spill; end if;
  end if;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_r))),3);
  pr_g := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_g))),3);

  welfare := least(1.5, greatest(0, cov_l));
  prosperity := round(least(1.30, greatest(0.85, 0.85 + 0.30*welfare)),3);
  if cov_l < 0.3 then st := 'stagnation';
  elsif cov_l < 0.5 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', raw->'pop',
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g),
    'spill',    jsonb_build_object('r',sp_r,'g',sp_g),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance_net(text) from public;
grant execute on function public._system_balance_net(text) to anon, authenticated;

-- ── Накопление статуса + МЯГКАЯ миграция/восстание + кэш prosperity ──
--   Бедность = только нехватка рабочих рук (cov_l), т.е. перегруз застройки.
create or replace function public._econ_update_status(p_fid text, p_days int)
returns void language plpgsql security definer set search_path=public as $$
declare
  s record; nb jsonb; w numeric; cur numeric; strn numeric; newst text;
  imp boolean; loss numeric; sysname text; sysgc numeric; is_cap boolean; prosp numeric;
begin
  for s in select distinct c.system_id as sid from public.colonies c
           where c.faction_id = p_fid and c.system_id is not null loop
    nb := public._system_balance_net(s.sid);
    w  := coalesce((nb->'coverage'->>'l')::numeric, 1);     -- благополучие = покрытие труда
    prosp := coalesce((nb->>'prosperity')::numeric, 1);
    imp := public._poverty_import_active(s.sid);
    is_cap := public._system_is_capital(s.sid);

    select strain into cur from public.system_econ where system_id = s.sid;
    strn := coalesce(cur, 0);
    if is_cap then strn := 0;
    elsif w < 0.3 then strn := strn + (case when imp then 0 else 1 end)*p_days;
    elsif w < 0.5 then strn := strn + (case when imp then 0 else 0.5 end)*p_days;
    elsif w >= 0.8 then strn := strn - 1.5*p_days;
    end if;
    strn := least(6, greatest(0, strn));
    newst := case when strn >= 5 then 'stagnation' when strn >= 3 then 'unrest' else 'ok' end;
    insert into public.system_econ(system_id, strain, status, prosperity, updated_at)
      values(s.sid, strn, newst, prosp, now())
      on conflict (system_id) do update
        set strain = excluded.strain, status = excluded.status,
            prosperity = excluded.prosperity, updated_at = now();

    if not is_cap then
      if w < 0.3 then
        update public.colonies set pop_mult = greatest(0.85, round(pop_mult - 0.01*p_days, 3))
          where system_id = s.sid;
      elsif w < 0.5 then
        update public.colonies set pop_mult = greatest(0.92, round(pop_mult - 0.005*p_days, 3))
          where system_id = s.sid;
      elsif w >= 0.8 then
        update public.colonies set pop_mult = least(1.0, round(pop_mult + 0.05*p_days, 3))
          where system_id = s.sid;
      end if;
    end if;

    if strn >= 6 and not is_cap
       and not coalesce((select revolt_until from public.system_econ where system_id = s.sid) > now(), false)
       and random() < (1 - power(0.9, p_days)) * 0.5 then
      select coalesce(sum(cells * coalesce(pop_mult,1)),0) into loss
        from public.colonies where system_id = s.sid;
      select gc into sysgc from public.faction_economy where faction_id = p_fid;
      loss := least(coalesce(sysgc,0) * 0.03, loss * 15);
      update public.faction_economy set gc = greatest(0, gc - round(loss)) where faction_id = p_fid;
      update public.system_econ set revolt_until = now() + interval '2 days' where system_id = s.sid;
      select name into sysname from public.map_systems where id = s.sid;
      insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
          title, excerpt, body, status, published_at, created_at, updated_at)
        values(p_fid, '🔥 БЕСПОРЯДКИ', 'rgba(200,60,40,0.55)', null, null,
          'Волнения из-за нужды', null,
          format('Длительная нехватка рабочих мест и нужда в системе «%s» вылилась в беспорядки. Казна недосчиталась %s ГС. Разрядите застройку или поддержите систему.',
            coalesce(sysname,'неизвестной системы'), to_char(round(loss), 'FM999999999')),
          'approved', now(), now(), now());
    end if;
  end loop;
end$$;
revoke all on function public._econ_update_status(text,int) from public;

-- ── РАЗОВЫЙ СБРОС СТЕЙЛА СТАРОЙ МОДЕЛИ + ПЕРЕСЧЁТ КЭША ───────
-- Без этого старые строки system_econ (status='stagnation', низкая prosperity от
-- прежней жёсткой модели) держат кабинет и КАРТУ красными до первого тика, т.к.
-- статус персистентный (_econ_adjust берёт сохранённый status). Выполняется один
-- раз при применении среза; повторный прогон файла безвреден (идемпотентно).

-- 1) гасим персистентную стагнацию/волнения и последствия восстаний у ВСЕХ систем
update public.system_econ set strain = 0, status = 'ok', revolt_until = null;

-- 2) возвращаем население, сбежавшее по старой жёсткой миграции
update public.colonies set pop_mult = 1 where coalesce(pop_mult,1) <> 1;

-- 3) немедленно пересчитываем кэш просперити/статуса по НОВОЙ модели
--    (теперь persist='ok', потолок стагнации не давит → чистые значения)
insert into public.system_econ (system_id, strain, status, prosperity, updated_at)
select sid, 0, (b->>'status'), (b->>'prosperity')::numeric, now()
from (select distinct system_id as sid from public.colonies where system_id is not null) c
cross join lateral (select public._system_balance_net(c.sid) as b) x
on conflict (system_id) do update
  set strain = 0, status = excluded.status,
      prosperity = excluded.prosperity, revolt_until = null, updated_at = now();

-- ── Проверка после применения ───────────────────────────────
-- select public.spatial_status();   -- coverage = {r,g,l} (без c); просперити 0.85..1.30
-- select public._system_is_capital('<sid>');  -- true для системы со столичной колонией
-- застрой систему плотно (мало населения, много построек) → cov_l↓ → просперити мягко вниз
