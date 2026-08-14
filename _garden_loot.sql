-- ══════════════════════════════════════════════════════════════
-- СОРТ КАМНЯ = ПОРОГ РЕДКОСТИ, А НЕ ПОДТАЛКИВАНИЕ
-- ══════════════════════════════════════════════════════════════
-- ⚠️ КАМНИ СТАЛИ РАЗНЫМИ НА ВИД, А СЫПАЛОСЬ ИЗ НИХ ОДНО И ТО ЖЕ. Замер по
-- живой системе (3000 бросков на сорт) показал две дыры:
--   1. «рудная жила» по составу почти неотличима от рядового камня: 55%
--      ростков — обычная порода, а «слиток» брал редкость вовсе без учёта
--      сорта. Лететь к кромке было не за чем — ровно та болезнь, которую
--      сорта и должны были вылечить;
--   2. пул = ресурсы СВОЕЙ системы, а их потолок «rare». Эпик и легендарка
--      (Старвис, Хтонит, Гравиядро, Рагенод, Программируемая материя) в поясе
--      не могли выпасть ФИЗИЧЕСКИ. Сиреневое ядро с ореолом обещало находку и
--      выдавало Железо.
-- Теперь сорт задаёт РАСПРЕДЕЛЕНИЕ ПО РЕДКОСТИ, и у ядра оно начинается там,
-- где у рядового камня заканчивается. Порода нужной редкости сперва ищется в
-- своей системе (тогда у ростка родной значок), а если её тут нет — камень
-- приносит то, чего в этом небе не добыть. Это и есть плата за дорогу.
--
-- Цепочка: после _garden_sprouts.sql, _garden_multi.sql, _garden_rare.sql
-- (перекрывает _g_rock_roll).
-- ══════════════════════════════════════════════════════════════

-- ── Галактический каталог пород ───────────────────────────────
-- Редкость — из resource_rarity (источник правды), значок — из справочника
-- ниже: в map_systems эпика встречается единицами, и выцеживать значок
-- сканом всех систем на каждый бросок сети незачем.
create or replace function public._g_res_cat(p_rar int)
returns jsonb language sql stable set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', rr.name, 'r', rr.rarity, 'icon', ic.icon)), '[]'::jsonb)
    from public.resource_rarity rr
    left join (values
      ('Железо','⚙️'), ('Силикаты','🪨'), ('Лёд','🧊'), ('Метан','💚'),
      ('Углерод','⬛'), ('Сера','🌑'),
      ('Титан','🔘'), ('Медь','🟤'), ('Ионит','🟡'), ('Аммиачный лёд','🟣'),
      ('Платина','⬜'), ('Редкоземельные руды','💡'), ('Дейтерий','⚛️'),
      ('Изотопы','☢️'), ('Реликтовое дерево','🧬'), ('Жидкая вода','🌊'),
      ('Гелий-3','🫧'),
      ('Хтонит','💎'), ('Старвис','🔥'), ('Стелларит','🔷'),
      ('Гравиядро','🔮'), ('Рагенод','💀'), ('Программируемая материя','🟢')
    ) as ic(name, icon) on ic.name = rr.name
   where public._g_rar(rr.rarity) = p_rar;
$$;

-- ── Порода заданной редкости ──────────────────────────────────
-- Сначала своё небо: если такая порода в системе есть, росток берёт её —
-- значок родной, и добытое можно узнать в собственных залежах. Нет — берём из
-- каталога: ядро приносит то, чего тут не добыть.
create or replace function public._g_res_of_rar(p_sys text, p_rar int)
returns jsonb language plpgsql stable set search_path=public as $$
declare v_own jsonb; v_cat jsonb; v_n int;
begin
  select coalesce(jsonb_agg(el), '[]'::jsonb) into v_own
    from jsonb_array_elements(public._g_res_pool(p_sys)) t(el)
   where public._g_rar(el->>'r') = p_rar;

  v_n := jsonb_array_length(v_own);
  if v_n > 0 then return v_own->(floor(random()*v_n)::int); end if;

  v_cat := public._g_res_cat(p_rar);
  v_n := jsonb_array_length(v_cat);
  if v_n > 0 then return v_cat->(floor(random()*v_n)::int); end if;
  return null;
end$$;

-- ── Жребий редкости по сорту камня ────────────────────────────
-- Полосы читаются глазом: у рядового камня хвост обрывается на «rare», у жилы
-- обычная порода уходит в меньшинство, у ядра её нет вовсе, зато появляется
-- эпик и — редко — легендарка. Ради этих двух строк и летят к кромке.
create or replace function public._g_rar_roll(p_tier int)
returns int language sql volatile set search_path=public as $$
  select case least(2, greatest(0, coalesce(p_tier,0)))
    when 2 then (case when random() < 0.05 then 4 when random() < 0.23 then 3
                      when random() < 0.75 then 2 else 1 end)
    when 1 then (case when random() < 0.04 then 3 when random() < 0.36 then 2
                      when random() < 0.75 then 1 else 0 end)
    else        (case when random() < 0.09 then 2 when random() < 0.32 then 1 else 0 end)
  end;
$$;

-- ══════════════════════════════════════════════════════════════
-- БРОСОК: содержимое камня
-- ══════════════════════════════════════════════════════════════
create or replace function public._g_rock_roll(p_sys text, p_tier int default 0)
returns jsonb language plpgsql volatile set search_path=public as $$
declare
  v_t int := least(2, greatest(0, coalesce(p_tier,0)));
  v_rv double precision := random();
  v_el jsonb; v_kind text; v_nm text; v_rar int := 0; v_gc numeric := 0;
  v_res text := null; v_icon text := null; v_hard numeric := 1; v_spore boolean := false;
  v_p_spore double precision;
  v_p_sprout double precision;
  v_p_ore double precision;
begin
  -- Полосы по виду добычи. Пустая порода — только у рядового камня: без
  -- промахов ловля перестаёт быть ловлей, но за дорогу к кромке платить пылью
  -- нельзя.
  v_p_spore  := case v_t when 2 then 0.060 when 1 then 0.032 else 0.012 end;
  v_p_sprout := v_p_spore  + case v_t when 2 then 0.700 when 1 then 0.680 else 0.600 end;
  v_p_ore    := v_p_sprout + case v_t when 2 then 0.240 when 1 then 0.288 else 0.250 end;

  if v_rv < v_p_spore then
    v_kind := 'spore'; v_nm := 'Спора мира'; v_rar := 4; v_hard := 1.7;
    v_spore := true; v_gc := 0;

  elsif v_rv < v_p_ore then
    -- Росток и порода тянут ОДИН жребий редкости: сорт камня решает и то, и
    -- другое. Раньше слиток брал редкость мимо сорта — жила и ядро давали
    -- ровно тот же щебень, что рядовой камень.
    v_rar := public._g_rar_roll(v_t);
    v_el  := public._g_res_of_rar(p_sys, v_rar);
    if v_el is null then v_el := public._g_res_of_rar(p_sys, 0); end if;

    if v_el is null then
      v_kind := 'dust'; v_rar := 0; v_hard := 0.8; v_nm := 'Пыль';
    else
      v_res  := v_el->>'name';
      v_icon := coalesce(v_el->>'icon', '◇');
      v_rar  := public._g_rar(v_el->>'r');
      if v_rv < v_p_sprout then
        v_kind := 'sprout';
        v_nm   := case v_t when 2 then 'Ядро: ' when 1 then 'Жила: ' else 'Росток: ' end || v_res;
        v_hard := 0.9 + v_rar * 0.22;
      else
        v_kind := 'ore';
        v_nm   := case v_t when 2 then 'Кристалл: ' when 1 then 'Слиток: ' else 'Обломок: ' end || v_res;
        -- Редкость теперь доходит и до цены: кристалл легендарной породы
        -- обязан читаться удачей, а не строкой в отчёте.
        v_gc   := ((260 + v_rar * 1150) * (1 + v_t * 1.35))::numeric;
        v_hard := 0.85 + v_rar * 0.12;
      end if;
    end if;

  else
    v_kind := 'dust'; v_rar := 0; v_hard := 0.75; v_gc := 0;
    v_nm := (array['Пыль и лёд','Пустая порода','Кусок шлака','Мёрзлая крошка'])
              [1 + floor(random()*4)::int];
  end if;

  -- Редкий камень и держится крепче: награда должна стоить работы руками.
  v_hard := v_hard + v_t * 0.28;

  return jsonb_build_object(
    'id', gen_random_uuid(), 'kind', v_kind, 'name', v_nm,
    'res', v_res, 'icon', v_icon, 'rar', v_rar, 'tier', v_t,
    'gc', v_gc, 'spore', v_spore, 'hard', round(v_hard, 2), 'sys', p_sys);
end$$;
