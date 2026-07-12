-- ════════════════════════════════════════════════════════════════════════════
--  ФИКС ДОБЫЧИ АВАНПОСТОВ v2 · 2026-07-12
--  1) Была сломана: settle гейтил добычу ОБЩИМ свободным местом склада (сумма
--     всех ресурсов). После авто-добычи v4 склад суммарно всегда «полон» →
--     freecap = 0 → аванпосты не добывали ничего. Теперь кламп ПО РЕСУРСУ
--     (ёмкость 1000 + слоты Склада × 500, × бюджетный множитель инфраструктуры).
--  2) Новая механика (юзер 2026-07-12): аванпост добывает ВСЕ ресурсы планет
--     своей системы, КРОМЕ эпических и легендарных (элита — только экзотический
--     экстрактор на колонии). Выбор одного ресурса (mine_res) больше не читается.
--  3) Кап пропущенных суток d ≤ 7 (анти-вывал, тот же класс бага «тысячи товаров»).
--  Ставки как раньше (вне границ ниже колониальных): common 12 · uncommon 6 · rare 3.
--  Требует применённого _budget_wellbeing.sql (_budget_cap_mult/_budget_row).
--  Идемпотентно. Катить ПОСЛЕ _budget_wellbeing.sql.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._outpost_mining_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record; relem jsonb; d int; dd int; rr text; rate numeric; rname text;
  cur jsonb; gc_total numeric := 0;
  cap numeric; addq numeric;
begin
  if not exists(select 1 from public.outposts where faction_id=p_fid and mode='mining'
                  and floor(extract(epoch from (now()-coalesce(last_accrue,created_at)))/86400.0) >= 1) then
    return;   -- нечего начислять
  end if;
  select coalesce(resources,'{}'::jsonb) into cur from public.faction_economy where faction_id=p_fid for update;
  if cur is null then return; end if;

  -- Ёмкость склада ПО РЕСУРСУ (не общий пул) — зеркало economy_accrue
  cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=p_fid and btype='warehouse'),0) * 500)
               * public._budget_cap_mult((public._budget_row(p_fid)).infra));

  for o in select * from public.outposts where faction_id=p_fid and mode='mining' loop
    d := floor(extract(epoch from (now()-coalesce(o.last_accrue,o.created_at)))/86400.0);
    if d < 1 then continue; end if;
    dd := least(d, 7);   -- анти-вывал: начисляем максимум за 7 пропущенных суток
    gc_total := gc_total + public._defense_const('outpost_mine_gc') * dd;

    -- ВСЕ ресурсы планет системы, кроме эпических и легендарных
    for relem in
      select r.value
      from jsonb_array_elements(coalesce((select planets from public.map_systems where id=o.system_id),'[]'::jsonb)) pl,
           jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) r
    loop
      rname := relem->>'name';
      if rname is null then continue; end if;
      rr := coalesce(relem->>'r', (select rarity from public.resource_rarity where name = rname), 'common');
      if rr in ('epic','legendary') then continue; end if;   -- элита — только экзотический экстрактор
      rate := case rr when 'uncommon' then 6 when 'rare' then 3 else 12 end;
      addq := least(rate * dd, greatest(0, cap - coalesce((cur->>rname)::numeric,0)));
      if addq > 0 then
        cur := jsonb_set(cur, array[rname], to_jsonb(coalesce((cur->>rname)::numeric,0) + addq), true);
      end if;
    end loop;

    update public.outposts set last_accrue = coalesce(last_accrue,created_at) + (d || ' days')::interval
      where id = o.id;
  end loop;

  update public.faction_economy set gc = gc + gc_total, resources = cur where faction_id = p_fid;
end$$;
revoke all on function public._outpost_mining_settle(text) from public;
