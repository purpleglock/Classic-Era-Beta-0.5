-- ════════════════════════════════════════════════════════════
-- ХРОНИКА · ЦЕНА ИСХОДА ДЛЯ НАЙДЕННЫХ МИРОВ  (этап 12)
--
-- precursor_saga_reward знала только исходы двух рукописей ('kailat', ...).
-- У найденных миров ключ свой на каждый мир, и класть строку наград на
-- каждый — то же самое, что класть строку сроков: их столько, сколько тел
-- на карте. Мир '*' читается как «любой», свой мира важнее общего.
--
-- Цифры от того, ЧЕМ ЗАКОНЧИЛОСЬ, а не от того, сколько было кликов:
--   ихор > 0 — мир отдал сам (отданное руками идёт без остатка, §15);
--   ихор < 0 — заплачено своим;
--   недоимка гасится всегда, когда счёт так или иначе закрыт, — разница
--   в том, кто и чем за это заплатил.
--
-- Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

insert into public.precursor_saga_reward (world, ending, ichor, arrears) values
  ('*', 'побратим',        40,  120),  -- уговор держат, и отдают по уговору
  ('*', 'своё_имя',        30,  100),  -- закрыли сами, но помнят, кто стоял рядом
  ('*', 'долгий_счёт',    -25,  160),  -- виру платили вы: со склада ушло
  ('*', 'отпущенные',      15,   60),  -- торгуют со всеми, вам без скидки
  ('*', 'ложный_устой',     0,   40),  -- всё выглядит закрытым
  ('*', 'немой_век',        0,   20),  -- заглажено: счёт не закрыт, но и не громкий
  ('*', 'смута',            0,    0),
  ('*', 'возвратный_ход',   0,    0),
  ('*', 'осыпь',            0,    0),
  ('*', 'выскобленные',    60,    0),  -- взяли всё; в книге недоимки это видно
  ('*', 'спящая_вещь',      0,    0)
on conflict (world, ending) do update
  set ichor = excluded.ichor, arrears = excluded.arrears;

-- Поиск цены: сперва своя мира, потом общая '*'.
create or replace function public._pc_saga_pay(p_fid text, p_world text, p_ending text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r public.precursor_saga_reward; v_have numeric; v_ich numeric; v_cut numeric;
        v_rows int;
begin
  select * into r from public.precursor_saga_reward
   where ending = p_ending and world in (p_world, '*')
   order by (world = p_world) desc limit 1;
  if not found then return jsonb_build_object('ichor', 0, 'arrears', 0); end if;

  v_ich := 0;
  if r.ichor <> 0 then
    select coalesce((resources->>'Ихор')::numeric, 0) into v_have
      from public.faction_economy where faction_id = p_fid;
    v_ich := case when r.ichor < 0 then -least(coalesce(v_have, 0), abs(r.ichor)) else r.ichor end;
    if v_ich <> 0 then
      update public.faction_economy
         set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
               to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) + v_ich, 3)), true)
       where faction_id = p_fid;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_ich := 0; end if;
    end if;
  end if;

  v_cut := 0;
  if r.arrears > 0 then
    select amount into v_have from public.pc_arrears where faction_id = p_fid;
    v_cut := least(coalesce(v_have, 0), r.arrears);
    if v_cut > 0 then
      update public.pc_arrears
         set amount = amount - v_cut, repaid = repaid + v_cut, updated_at = now()
       where faction_id = p_fid;
      insert into public.pc_arrears_log (faction_id, kind, ichor, weight)
        values (p_fid, 'зачёт', 0, v_cut);
    end if;
  end if;

  return jsonb_build_object('ichor', v_ich, 'arrears', v_cut);
end$$;
revoke all on function public._pc_saga_pay(text, text, text) from public, anon, authenticated;
