-- ============================================================
-- ПРОЗА СОБЫТИЙ СЕКТОРА: живые, разнообразные формулировки хроник
--
-- Раньше каждое событие («Экспансия», «Новое государство», «Новая религия»,
-- «Союз», «Вассалитет», «Достижение») имело ОДНУ зашитую фразу — лента
-- выглядела однообразно и сухо. Здесь те же функции-постеры переопределяются:
-- к каждому событию — несколько атмосферных вариантов текста, один берётся
-- случайно (_news_pick). Заголовки и причастные фракции (mentions) не меняются.
--
-- Переопределяет функции из _sector_bulletins.sql, _news_lifecycle.sql и
-- _news_mentions.sql (news_announce_ach). Триггеры НЕ пересоздаём — они уже
-- привязаны к этим функциям по имени. Идемпотентно, best-effort.
-- Применять ПОСЛЕ _sector_bulletins.sql + _news_lifecycle.sql + _news_mentions.sql.
-- ============================================================

-- Случайный выбор одной строки из набора вариантов.
create or replace function public._news_pick(p_arr text[])
returns text language sql volatile set search_path=public as $$
  select p_arr[1 + floor(random()*greatest(array_length(p_arr,1),1))::int];
$$;

-- ── Экспансия: захват системы (map_systems.faction null → задан) ──
create or replace function public._sector_claim_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; sys text;
begin
  if NEW.faction is not null and OLD.faction is null then
    begin
      nm  := coalesce(nullif(public._fac_name(NEW.faction),''), 'Одна из держав');
      sys := coalesce(NEW.name,'—');
      perform public._post_sector_news(
        'Экспансия: ' || nm || ' — система ' || sys,
        public._news_pick(array[
          format('%s поднимает свой флаг над системой %s. Границы сектора дрогнули — навигаторы переписывают карты, а соседи пересчитывают корабли.', nm, sys),
          format('Система %s переходит под руку державы %s. Над звездой загорается новый герб, патрули меняют коды опознания.', sys, nm),
          format('%s устанавливает контроль над %s. Торговые гильдии спешно перекладывают маршруты, наблюдатели фиксируют свежий рубеж на карте.', nm, sys),
          format('Звезда %s сменила хозяина: теперь это владение державы %s. Где-то ликуют, где-то точат клинки.', sys, nm)
        ]));
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;

-- ── Появление новой фракции (status → approved) ──
create or replace function public._sector_newfaction_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text;
begin
  if NEW.status = 'approved' and (OLD.status is distinct from 'approved') then
    begin
      nm := coalesce(NEW.name,'неизвестная держава');
      perform public._post_sector_news(
        'Новое государство: ' || coalesce(NEW.name,'—'),
        public._news_pick(array[
          format('На карте сектора вспыхивает новое имя — %s. Послы соседних держав уже шлют первые шифровки, гадая о намерениях новичка.', nm),
          format('Заявило о себе новое государство, %s. Биржи закладывают неизвестность в котировки, дипломаты — в свои депеши.', nm),
          format('%s выходит из тени и провозглашает себя державой сектора. Прежняя расстановка сил больше не действует.', nm),
          format('Над сектором поднимается флаг доселе безвестной державы — %s. Хронисты открывают новую страницу.', nm)
        ]),
        NEW.color);
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;

-- ── Вера: основана религия ──
create or replace function public._life_faith_found_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; fname text;
begin
  begin
    nm    := coalesce(nullif(public._fac_name(NEW.founder_fid),''),'Неизвестная держава');
    fname := coalesce(NEW.name,'—');
    perform public._post_life_news(
      '☉ Новая религия: ' || fname,
      public._news_pick(array[
        format('%s провозглашает рождение веры «%s». Первые молитвы возносятся к звёздам, и весть об учении расходится по караванным путям.', nm, fname),
        format('Из недр державы %s рождается новое учение — «%s». Жрецы зажигают алтари, проповедники готовятся в дальний путь.', nm, fname),
        format('Над %s занимается заря новой веры «%s». Одни видят в ней свет, другие — угрозу прежним богам.', nm, fname)
      ]),
      coalesce(nullif(NEW.color,''),'rgba(201,162,39,0.55)'),
      jsonb_build_array(NEW.founder_fid));
  exception when others then null;
  end;
  return NEW;
end$$;

-- ── Вера: фракция приняла веру ──
create or replace function public._life_faith_join_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; fn text; ffid text;
begin
  if NEW.role = 'member' then
    begin
      nm := coalesce(nullif(public._fac_name(NEW.faction_id),''),'Одна из держав');
      select name, founder_fid into fn, ffid from public.faiths where id = NEW.faith_id;
      fn := coalesce(fn,'—');
      perform public._post_life_news(
        '✛ Обращение: ' || nm,
        public._news_pick(array[
          format('%s принимает веру «%s». Храмы полнятся, число последователей учения растёт.', nm, fn),
          format('Народ державы %s склоняется к учению «%s». Жрецы встречают новую паству.', nm, fn),
          format('%s присоединяется к вере «%s». Ещё одна звезда вспыхивает на небосклоне учения.', nm, fn)
        ]),
        'rgba(201,162,39,0.5)',
        jsonb_build_array(NEW.faction_id) || (case when ffid is not null then jsonb_build_array(ffid) else '[]'::jsonb end));
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;

-- ── Дипломатия: создан союз ──
create or replace function public._life_union_create_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; kindru text; un text;
begin
  begin
    nm     := coalesce(nullif(public._fac_name(NEW.leader_fid),''),'Одна из держав');
    kindru := case NEW.kind when 'federation' then 'федерацию' when 'confederation' then 'конфедерацию' else 'союз' end;
    un     := coalesce(NEW.name,'—');
    perform public._post_life_news(
      '⬡ Новый союз: ' || un,
      public._news_pick(array[
        format('%s учреждает %s «%s». Подписаны хартии, и дипломаты сектора спешно пересматривают расстановку сил.', nm, kindru, un),
        format('Рождается %s «%s» под рукой державы %s. Флаги объединяются, противники мрачнеют.', kindru, un, nm),
        format('%s скрепляет печатью новую %s — «%s». Союзники празднуют, соседи настораживаются.', nm, kindru, un)
      ]),
      'rgba(95,176,230,0.5)',
      jsonb_build_array(NEW.leader_fid));
  exception when others then null;
  end;
  return NEW;
end$$;

-- ── Дипломатия: фракция вступила в союз ──
create or replace function public._life_union_join_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; un text; lead text;
begin
  begin
    select u.name, u.leader_fid into un, lead from public.diplo_unions u where u.id = NEW.union_id;
    if lead is not null and lead <> NEW.fid then
      nm := coalesce(nullif(public._fac_name(NEW.fid),''),'Одна из держав');
      un := coalesce(un,'—');
      perform public._post_life_news(
        '⬡ Пополнение союза: ' || un,
        public._news_pick(array[
          format('%s вступает в союз «%s». Ряды объединения крепнут, его голос в секторе звучит громче.', nm, un),
          format('Под знамёна союза «%s» становится %s. Ещё одна держава вверяет ему свою судьбу.', un, nm),
          format('%s присягает союзу «%s». Договор скреплён, границы союзников смыкаются плотнее.', nm, un)
        ]),
        'rgba(95,176,230,0.5)',
        jsonb_build_array(NEW.fid) || (case when lead is not null then jsonb_build_array(lead) else '[]'::jsonb end));
    end if;
  exception when others then null;
  end;
  return NEW;
end$$;

-- ── Дипломатия: заключён вассалитет ──
create or replace function public._life_vassal_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare lord text; vas text; pct int;
begin
  if NEW.status = 'active' and (OLD.status is distinct from 'active') then
    begin
      lord := coalesce(nullif(public._fac_name(NEW.overlord_fid),''),'Сюзерен');
      vas  := coalesce(nullif(public._fac_name(NEW.vassal_fid),''),'Вассал');
      pct  := round(coalesce(NEW.tribute_pct,0)*100);
      perform public._post_life_news(
        '⚜ Вассальная присяга',
        public._news_pick(array[
          format('%s склоняет голову перед державой %s. Скреплён вассальный договор — дань %s%% в обмен на защиту сильного.', vas, lord, pct),
          format('%s приносит вассальную присягу сюзерену %s. Отныне %s%% её доходов течёт ко двору господина.', vas, lord, pct),
          format('Над %s простирается длань державы %s: заключён вассальный союз (дань %s%%). Слабый ищет защиты, сильный — славы.', vas, lord, pct)
        ]),
        'rgba(180,140,90,0.5)',
        jsonb_build_array(NEW.overlord_fid, NEW.vassal_fid));
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;

-- ── Достижение получено ──
create or replace function public.news_announce_ach(p_ach_id text, p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_name text; nm text;
begin
  if public.current_user_banned() then return jsonb_build_object('ok',false); end if;
  v_fid := public._ec_my_fid();
  if not exists(select 1 from public.faction_achievements
       where faction_id=v_fid and ach_id=p_ach_id and announced=false) then
    return jsonb_build_object('ok',false,'skipped',true);
  end if;
  update public.faction_achievements set announced=true
    where faction_id=v_fid and ach_id=p_ach_id;
  v_name := coalesce(nullif(public._fac_name(v_fid),''),'Одна из держав');
  nm := coalesce(nullif(btrim(p_name),''), p_ach_id);
  perform public._post_life_news(
    '🏆 Достижение: ' || v_name,
    public._news_pick(array[
      format('%s вписывает в свою летопись достижение «%s». Хронисты сектора отмечают новую веху в истории державы.', v_name, nm),
      format('Держава %s удостоена признания: «%s». Награда занесена в анналы, имя — на скрижали сектора.', v_name, nm),
      format('%s достигает рубежа «%s». Глашатаи разносят весть, соперники скрипят зубами.', v_name, nm)
    ]),
    'rgba(224,176,74,0.5)',
    jsonb_build_array(v_fid));
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.news_announce_ach(text,text) from public, anon;
grant execute on function public.news_announce_ach(text,text) to authenticated;
