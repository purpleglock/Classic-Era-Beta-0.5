-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ПОВОД ВОЙНЫ: НА МЕСТЕ ПРИЧИНЫ ПУСТО
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_registry.sql. Надмножество `_angel_declare`.
-- Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Повод войны назывался «ДеМЗАфикация». Это шутка про МЗА, и
-- она ломает всё, что вокруг: у отметки, которая не отвечает на запросы и чьи
-- сводки идут помехами, в графе «причина войны» стояло сочинённое канцелярское
-- слово. Оно объясняет — а объяснения у него как раз и нет.
-- Второй повод, «Присутствие», был не лучше: он описывал БАГ (сел над чужой
-- колонией — объявил войну соседу), и после реестра описывать ему нечего.
--
-- ПРАВИЛО. Графа «причина» у этой войны есть, и она НЕ ПУСТАЯ — в ней просто
-- не язык. Заголовок поля целый, содержимое — помехи. Это читается сильнее
-- любого страшного слова: канцелярия работает, форма заполнена, а прочесть
-- нельзя.
--
-- ⚠️ ШУМ, А НЕ ИСКАЖЁННОЕ СЛОВО. Пробовал `_angel_glitch('Причина не
-- установлена')` — выходит «П┼и⟟ин▞ не уст⨯н╬⍜лена», то есть фраза, которую
-- глазом всё равно дочитываешь до конца. Дочитал — значит объяснили.
-- `_angel_scream` не дочитывается ничем.
--
-- ⚠️ У КАЖДОЙ ВОЙНЫ ШУМ СВОЙ. Это не небрежность: одинаковая строка во всех
-- строках реестра прочиталась бы как код ошибки, то есть снова как объяснение.
-- ════════════════════════════════════════════════════════════

-- Одна точка правды: и объявление, и починка старых строк берут повод отсюда.
create or replace function public._angel_cause()
returns text language sql volatile as $$
  select '◈ Причина: ' || public._angel_scream(14)
$$;
revoke all on function public._angel_cause() from public;

-- ── ОБЪЯВЛЕНИЕ ВОЙНЫ — НАДМНОЖЕСТВО ─────────────────────────
-- Дословный `_angel_declare` из _angel_registry.sql (заслонка реестра на
-- месте), правка одна — повод.
create or replace function public._angel_declare(p_target text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; w uuid; nfoes int;
begin
  af := public._angel_fid();
  if af is null or p_target is null or p_target = af then
    return jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from public.faction_applications
                  where faction_id = p_target and status = 'approved') then
    return jsonb_build_object('ok', false, 'why', 'нет такой державы');
  end if;
  if public.at_war(af, p_target) then return jsonb_build_object('ok', true, 'already', true); end if;

  select count(*) into nfoes from public._angel_foes(af);
  if nfoes > 0 and not exists (select 1 from public._angel_foes(af) f where f.fid = p_target) then
    return jsonb_build_object('ok', true, 'skipped', 'не в реестре', 'fid', p_target);
  end if;

  insert into public.wars(attacker_fid, defender_fid, cause)
    values (af, p_target, public._angel_cause()) returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, af, 'attacker'), (w, p_target, 'defender');

  perform public._war_news(
    public._angel_glitch('◈ Оно пришло: ' || public._war_nm(af) || ' → ' || public._war_nm(p_target), 0.18),
    public._angel_glitch(
      'Отметка вышла из прыжка над их мирами. Переговоров не было: их не с кем вести. '
      || 'В графу «причина» дежурный внёс то, что пришло по каналу. ', 0.16)
      || public._angel_scream(14),
    jsonb_build_array(af, p_target));
  return jsonb_build_object('ok', true, 'war_id', w);
end$$;
revoke all on function public._angel_declare(text) from public;

notify pgrst, 'reload schema';

-- ── ПЕРЕПИСАТЬ УЖЕ ЗАПИСАННОЕ ───────────────────────────────
-- ⚠️ Каждой строке — свой шум, поэтому обновляем построчно, а не одним
-- UPDATE: `_angel_cause()` volatile, но в множественном UPDATE планировщик
-- вправе вычислить её один раз на всё, и все войны получили бы одну строку.
do $$
declare r record; n int := 0;
begin
  for r in select w.id, w.cause from public.wars w
            where exists (select 1 from public.angel_state a
                           where a.faction_id in (w.attacker_fid, w.defender_fid))
              and coalesce(w.cause, '') not like '◈ Причина:%'
  loop
    update public.wars set cause = public._angel_cause() where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'поводов переписано: %', n;
  for r in select w.cause, public._war_nm(w.defender_fid) foe, w.status from public.wars w
            where exists (select 1 from public.angel_state a
                           where a.faction_id in (w.attacker_fid, w.defender_fid))
            order by w.started_at
  loop
    raise notice '   % · % · %', r.cause, r.foe, r.status;
  end loop;
end$$;
