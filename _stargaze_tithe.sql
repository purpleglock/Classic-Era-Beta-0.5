-- ============================================================
-- 🜂 РАЗЛОМ · ДУХОВНЫЙ ПАТРОНАТ — 5% ставки державе-покровителю
-- ============================================================
-- Применять ПОСЛЕ _stargaze.sql и _faith_setup.sql. Идемпотентно.
-- ⚠️ ПЕРЕКАТЫВАТЬ ЦЕЛИКОМ: ранние ревизии этого файла уже уезжали в прод и
-- проверяли патрона по faith_membership («исповедует»), а не по праву основать
-- веру. Симптом расхождения: клиент показывает державу в списке, а сервер на
-- выбор отвечает «эта держава не исповедует веры».
--
-- Первая версия механики гоняла десятину «по храмам в секторе транса» — юзер
-- забраковал: слишком сложно. Теперь всё политически просто:
--
--   • Кому вера доступна по «уставу» (_faith_can_found: Спиритуализм /
--     Теократия / админ) — играют КАК РАНЬШЕ. Никакого патрона, никакой
--     десятины: их медиумы у себя дома.
--   • Все остальные ВВЕРЯЮТ себя державе-патрону — той, у кого право на веру
--     ЕСТЬ. Её хор ведёт транс, и 5% от поставленного идёт ей в казну. Без
--     патрона Разлом для мирянина не отзывается вовсе.
--
-- Патрон — постоянный выбор державы (faction_economy.rift_patron_fid), а не
-- разовая настройка ставки: назначается во вкладке «🤝 Политика» и зеркалом
-- на экране ставок (юзер: «чтоб не бегать по сто раз»). В патроны годится
-- держава с ПРАВОМ ОСНОВАТЬ веру (Спиритуализм/Теократия), а не всякая
-- исповедующая: принять веру может кто угодно, но доход патроната — только
-- тем, на кого вера завязана по уставу. Себя самого выбрать нельзя.
--
-- Десятина берётся ИЗ ставки, а не сверху: цена транса прежняя
-- (stake × (1+extras)), выплаты игроку прежние. Меняется только то, что 5%
-- этих денег достаётся патрону, а не исчезает в казино. Предупреждение на
-- входе политическое: игрок видит, КОГО он спонсирует.
--
-- Зеркало клиента — economy.js (ecStarsBody / ecPatronBlock), ?v=20260715patron3.
-- ============================================================

-- ── 0) Подчистка забракованной ревизии «десятина по храмам в секторе» ──
-- Если она успела попасть в прод: там stargaze_start был с ТРЕТЬИМ аргументом
-- (p_sector uuid), а двухаргументный — дропнут. Клиент зовёт двухаргументный,
-- так что лишнюю перегрузку надо снести, иначе PostgREST может выбрать её.
drop function if exists public.stargaze_start(numeric, int, uuid);
drop function if exists public.stargaze_sectors();
drop function if exists public._stargaze_sector_temples(uuid);
alter table public.stargaze_state drop column if exists sector_id;
alter table public.stargaze_state drop column if exists tithe;

alter table public.faction_economy add column if not exists rift_patron_fid text;
-- Патроны, выбранные по СТАРОМУ правилу (просто «исповедует веру»), больше не
-- проходят: сбрасываем тех, у кого права на веру нет — иначе игрок упёрся бы в
-- «патрон потерял право на веру» и не понял, откуда это.
update public.faction_economy
  set rift_patron_fid = null
  where rift_patron_fid is not null
    and not coalesce((
      select a.ideology = 'Спиритуализм' or a.gov = 'Теократия'
      from public.faction_applications a
      where a.faction_id = faction_economy.rift_patron_fid and a.status = 'approved'
      order by a.updated_at desc limit 1
    ), false);

-- ── Годится ли держава в патроны ──
-- ВАЖНО: не «исповедует веру», а ИМЕЕТ ПРАВО ЕЁ ОСНОВАТЬ (Спиритуализм /
-- Теократия). Исповедовать может кто угодно — доход же с патроната идёт только
-- тем, на кого вера завязана по уставу.
-- Это НЕ _faith_can_found: там есть админская ветка current_user_role(), а она
-- смотрит на КЛИКНУВШЕГО. Через неё админ смог бы вверить державу кому угодно.
create or replace function public._rift_patron_ok(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((
    select a.ideology = 'Спиритуализм' or a.gov = 'Теократия'
    from public.faction_applications a
    where a.faction_id = p_fid and a.status = 'approved'
    order by a.updated_at desc limit 1
  ), false)
$$;
revoke all on function public._rift_patron_ok(text) from public, anon;

-- ── Вверить себя державе (или отозвать: p_fid = null) ──
create or replace function public.stargaze_patron_set(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  p_fid := nullif(trim(coalesce(p_fid, '')), '');

  if p_fid is not null then
    if p_fid = fid then
      raise exception 'bad patron: нельзя вверить себя самому себе';
    end if;
    if not public._rift_patron_ok(p_fid) then
      raise exception 'bad patron: у этой державы нет права на веру — её хор не поведёт транс';
    end if;
  end if;

  -- Транс уже идёт: патрон зафиксирован на сеанс, десятина уплачена.
  if exists (select 1 from public.stargaze_state where faction_id = fid and active) then
    raise exception 'round active: транс уже идёт — смените патрона после него';
  end if;

  update public.faction_economy set rift_patron_fid = p_fid where faction_id = fid;
  return jsonb_build_object('ok', true, 'patron_fid', p_fid);
end$$;
revoke all on function public.stargaze_patron_set(text) from public, anon;
grant execute on function public.stargaze_patron_set(text) to authenticated;

-- ── Старт транса: десятина патрону ──
-- Сигнатура та же (numeric,int) — стартовать мимо десятины нечем: патрон
-- берётся из состояния державы, а не из аргумента.
create or replace function public.stargaze_start(p_stake numeric, p_extra int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.stargaze_state; cost numeric; v_gc numeric;
        free boolean; patron text; tithe numeric; p_name text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  if p_stake is null or p_stake < 100 or p_stake > 100000 then
    raise exception 'bad stake: ставка от 100 до 100 000 ГС';
  end if;
  p_stake := floor(p_stake);
  if p_extra is null or p_extra < 0 or p_extra > 4 then
    raise exception 'bad extra: доп. ставок 0..4';
  end if;

  free := public._faith_can_found(fid);
  select rift_patron_fid into patron from public.faction_economy where faction_id = fid;

  -- Мирянину патрон обязателен и обязан всё ещё иметь право на веру: держава
  -- могла сменить идеологию/строй уже ПОСЛЕ того, как её выбрали.
  if not free then
    if patron is null then
      raise exception 'no patron: вверьте державу духовному патрону — без верующего хора Разлом не отзовётся';
    end if;
    if not public._rift_patron_ok(patron) then
      raise exception 'patron lapsed: ваш патрон потерял право на веру — выберите другого';
    end if;
  else
    patron := null;
  end if;

  insert into public.stargaze_state(faction_id, owner_id)
    values (fid, auth.uid())
    on conflict (faction_id) do nothing;
  select * into st from public.stargaze_state where faction_id = fid for update;
  if st.active then
    raise exception 'round active: транс уже идёт — сначала доведите его до конца';
  end if;

  cost := p_stake * (1 + p_extra);
  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost
    returning gc into v_gc;
  if not found then raise exception 'not enough GC: погружение стоит % ГС', cost; end if;

  -- ── Десятина: 5% поставленного — в казну патрона ──
  tithe := 0;
  if patron is not null then
    tithe := floor(cost * 0.05);
    if tithe > 0 then
      update public.faction_economy set gc = gc + tithe where faction_id = patron;
      p_name := coalesce(nullif(public._fac_name(patron), ''), 'Безымянная держава');
    end if;
  end if;

  update public.stargaze_state
    set active = true, board = public._stargaze_board(), stake = p_stake,
        extras = p_extra, picks = 3 + p_extra, opened = '[]'::jsonb,
        owner_id = auth.uid(), updated_at = now()
    where faction_id = fid;

  return jsonb_build_object('ok', true, 'active', true, 'stake', p_stake,
    'extras', p_extra, 'picks', 3 + p_extra, 'mult', 1 + 0.25 * p_extra,
    'opened', '[]'::jsonb, 'gc', v_gc, 'spent', cost,
    'tithe', tithe, 'patron_fid', patron, 'patron_name', p_name);
end$$;
revoke all on function public.stargaze_start(numeric, int) from public, anon;
grant execute on function public.stargaze_start(numeric, int) to authenticated;
