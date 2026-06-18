-- ============================================================
-- ДОСТИЖЕНИЯ ФРАКЦИИ (ачивки) — в стиле стоицизма
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Награда (ГС) и сам факт получения считаются ТОЛЬКО на сервере:
--   RPC ach_check() пересчитывает условия из реальных таблиц, выдаёт
--   новые ачивки (on conflict do nothing — без двойной выдачи) и
--   начисляет ГС. Клиент не может вписать ачивку или начислить себе ГС
--   напрямую — закрываем дыру прямой записи (см. memory: client-write RLS hole).
--
-- Каталог (id / условие / награда) — зеркало EC_ACH в economy.js.
-- Видны ачивки только во вкладке «Обзор» кабинета (ecAchPanel).
-- ============================================================

-- ── Таблица выданных ачивок ─────────────────────────────────
create table if not exists public.faction_achievements (
  faction_id text        not null,
  ach_id     text        not null,
  reward     int         not null default 0,   -- сколько ГС начислено при выдаче
  earned_at  timestamptz not null default now(),
  primary key (faction_id, ach_id)
);

alter table public.faction_achievements enable row level security;

-- Читать может только владелец своей фракции (для прямого dbGet, если понадобится).
-- Запись/удаление — НЕ разрешены никому (нет политик) → только SECURITY DEFINER RPC.
drop policy if exists fa_select_own on public.faction_achievements;
create policy fa_select_own on public.faction_achievements
  for select using (
    exists (select 1 from public.faction_economy fe
            where fe.faction_id = faction_achievements.faction_id
              and fe.owner_id   = auth.uid())
  );

revoke insert, update, delete on public.faction_achievements from anon, authenticated;
grant  select on public.faction_achievements to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: проверка и выдача ачивок
--   Вызывается клиентом при заходе в кабинет (ecLoad).
--   Возвращает { newly, gc, new_ids[], earned[{id,reward,earned_at}] }.
-- ════════════════════════════════════════════════════════════
create or replace function public.ach_check()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text;
  v_research  int;
  v_gc        numeric;
  v_buildings int;
  v_colonies  int;
  v_attacked  boolean;
  v_route     boolean;
  v_raid      boolean;
  v_spy       boolean;
  v_loan      boolean;
  rec         record;
  newly       int := 0;
  new_ids     jsonb := '[]'::jsonb;
begin
  fid := public._ec_my_fid();   -- своя одобренная фракция (+ проверка бана)

  select coalesce(jsonb_array_length(coalesce(research, '[]'::jsonb)), 0),
         coalesce(gc, 0)
    into v_research, v_gc
    from public.faction_economy where faction_id = fid;
  v_research := coalesce(v_research, 0);
  v_gc       := coalesce(v_gc, 0);

  select count(*) into v_buildings from public.colony_buildings where faction_id = fid;
  select count(*) into v_colonies  from public.colonies         where faction_id = fid;

  -- против меня запускали вражескую операцию (шпионаж) — и я уцелел
  v_attacked := exists (select 1 from public.spy_missions where target_fid = fid);
  -- есть действующий торговый путь (мой как отправитель или получатель)
  v_route := exists (select 1 from public.trade_routes
                     where (a_fid = fid or b_fid = fid) and status = 'active');
  -- успешный рейд: завершён и что-то угнано (груз или ГС)
  v_raid := exists (select 1 from public.raid_missions
                    where actor_fid = fid and status = 'done'
                      and (coalesce((outcome->>'loot_units')::numeric, 0) > 0
                        or coalesce((outcome->>'loot_gc')::numeric, 0) > 0));
  -- успешная операция разведки (любая моя операция с исходом success)
  v_spy := exists (select 1 from public.spy_missions where actor_fid = fid and outcome = 'success');
  -- я выдал заём другой фракции
  v_loan := exists (select 1 from public.loans where lender_fid = fid);

  -- Каталог: (id, награда ГС, выполнено?) — зеркало EC_ACH в economy.js
  for rec in
    select * from (values
      ('sibi_imperare', 1000, v_research  >= 1),
      ('constantia',    2000, v_buildings >= 10),
      ('cosmopolites',  2500, v_colonies  >= 5),
      ('amor_fati',        0, v_attacked),
      ('dichotomia',    1500, v_route),
      ('temperantia',      0, v_gc >= 10000),
      ('sophia',        4000, v_research  >= 10),
      ('fortitudo',     4000, v_raid),
      ('prudentia',     3500, v_spy),
      ('iustitia',      3500, v_loan),
      ('magnum_opus',   7000, v_buildings >= 30)
    ) as t(ach_id, reward, met)
  loop
    if rec.met then
      insert into public.faction_achievements(faction_id, ach_id, reward)
        values (fid, rec.ach_id, rec.reward)
        on conflict (faction_id, ach_id) do nothing;
      if found then                 -- именно сейчас выдали (а не уже была)
        newly   := newly + 1;
        new_ids := new_ids || to_jsonb(rec.ach_id);
        if rec.reward > 0 then
          update public.faction_economy set gc = gc + rec.reward where faction_id = fid;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'newly',   newly,
    'new_ids', new_ids,
    'gc',      (select gc from public.faction_economy where faction_id = fid),
    'earned',  coalesce((
        select jsonb_agg(jsonb_build_object('id', ach_id, 'reward', reward, 'earned_at', earned_at)
                         order by earned_at)
        from public.faction_achievements where faction_id = fid), '[]'::jsonb)
  );
end$$;

revoke all on function public.ach_check() from public, anon;
grant execute on function public.ach_check() to authenticated;
