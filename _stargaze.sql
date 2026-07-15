-- ============================================================
-- 🜂 ВСМОТРЕТЬСЯ В РАЗЛОМ — псионический хор-казино в новелле
-- ============================================================
-- Тема: Разлом материи (см. _migration_rift.sql) — разрыв в ткани
-- мироздания, за которым иная вселенная. Медиумы державы входят в транс
-- и щупают его узлы: где-то там чужой разум, а где-то только белый шум.
--
-- Игрок делает ставку (депчик от 100 до 100 000 ГС) и получает поле
-- 7×7 = 49 «узлов Разлома». Базовая ставка даёт 3 погружения; каждая
-- ДОПОЛНИТЕЛЬНАЯ ставка того же размера — +1 погружение И +25% к
-- множителю ВСЕХ выигрышей сеанса (до +4 доп. ставок = 7 погружений, ×2).
--
-- Раскладка призов на поле (множитель от ставки, до глобального множителя):
--   • 1  × «Взгляд в ответ» (ДЖЕКПОТ) ×6
--   • 2  × «Псионический маяк»        ×2
--   • 4  × «Эхо Разлома»              ×0.8
--   • 8  × «Видение»                  ×0.25
--   • 34 × «Белый шум»                ×0.02
-- RTP базового сеанса ≈ 97%, с доп.ставками ≈ 81–91% (казино в плюсе).
-- Ключи типов (nova/quasar/comet/photo/dust) — ЛЕГАСИ от старой
-- «обсерватории»: они зеркалятся в economy.js (EC_STARS_TYPES) и в
-- админском фотоархиве, поэтому переименована только подача, не коды.
--
-- КЛЮЧЕВОЕ (требование юзера): когда погружения кончились, игроку
-- ПОКАЗЫВАЕТСЯ ВСЁ ПОЛЕ — и обязательно ГДЕ БЫЛ ДЖЕКПОТ. Поэтому поле
-- прячется на сервере (никакого select на таблицу!), а полная раскладка
-- отдаётся только в ответе ПОСЛЕДНЕГО погружения (поле done).
--
-- Выигрыш зачисляется СРАЗУ при вскрытии узла. Джекпот пишется в
-- ленту событий (◈ Хроника сектора) best-effort через _post_life_news.
-- Зеркало клиента — economy.js (ecStarsBody) + render.js (heroVNStarsOpen),
-- ?v=20260715rift1. Не применялось автоматически: катить как обычный срез.
-- ============================================================

-- ── Состояние резонатора Разлома: одна строка на фракцию ──
create table if not exists public.stargaze_state (
  faction_id  text primary key,
  owner_id    uuid,
  active      boolean not null default false,
  board       jsonb,                -- СКРЫТАЯ раскладка 49 узлов [{t,m},…] (пока active)
  stake       numeric not null default 0,
  extras      int not null default 0,      -- доп. ставок (0..4)
  picks       int not null default 0,      -- всего погружений в сеансе (3+extras)
  opened      jsonb not null default '[]', -- вскрытые [{i,t,m,win},…]
  last        jsonb,                -- финал прошлого сеанса (полная раскладка + итог)
  updated_at  timestamptz default now()
);
alter table public.stargaze_state enable row level security;
-- НИКАКОГО select-полиси: поле с раскладкой не должно утекать до финала.
revoke select, insert, update, delete on public.stargaze_state from public, anon, authenticated;

-- ── Свежая раскладка Разлома: 49 призов вперемешку ──
create or replace function public._stargaze_board()
returns jsonb language sql volatile as $$
  select jsonb_agg(jsonb_build_object('t', t, 'm', m) order by random())
  from (
    select 'nova'::text as t, 6::numeric as m
    union all select 'quasar', 2    from generate_series(1,2)
    union all select 'comet',  0.8  from generate_series(1,4)
    union all select 'photo',  0.25 from generate_series(1,8)
    union all select 'dust',   0.02 from generate_series(1,34)
  ) x
$$;

-- ── Текущее состояние (read-only, для клиента; поле НЕ раскрывает) ──
create or replace function public.stargaze_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.stargaze_state;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('active', false, 'opened', '[]'::jsonb); end if;
  select * into st from public.stargaze_state where faction_id = fid;
  if not found or not st.active then
    return jsonb_build_object('active', false, 'opened', '[]'::jsonb);
  end if;
  return jsonb_build_object('active', true, 'stake', st.stake, 'extras', st.extras,
    'picks', st.picks, 'mult', 1 + 0.25 * st.extras, 'opened', st.opened);
end$$;
revoke all on function public.stargaze_get() from public, anon;
grant execute on function public.stargaze_get() to authenticated;

-- ── Начать транс: списать ставку×(1+extras), разложить Разлом ──
create or replace function public.stargaze_start(p_stake numeric, p_extra int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.stargaze_state; cost numeric; v_gc numeric;
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

  update public.stargaze_state
    set active = true, board = public._stargaze_board(), stake = p_stake,
        extras = p_extra, picks = 3 + p_extra, opened = '[]'::jsonb,
        owner_id = auth.uid(), updated_at = now()
    where faction_id = fid;

  return jsonb_build_object('ok', true, 'active', true, 'stake', p_stake,
    'extras', p_extra, 'picks', 3 + p_extra, 'mult', 1 + 0.25 * p_extra,
    'opened', '[]'::jsonb, 'gc', v_gc, 'spent', cost);
end$$;
revoke all on function public.stargaze_start(numeric, int) from public, anon;
grant execute on function public.stargaze_start(numeric, int) to authenticated;

-- ── Вскрыть узел: выигрыш СРАЗУ в казну; на последнем — раскрыть ВЕСЬ Разлом ──
create or replace function public.stargaze_pick(p_idx int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.stargaze_state; cell jsonb; mult numeric; win numeric;
        op jsonb; done boolean; v_gc numeric; jack_i int; total numeric; fin jsonb;
        v_nm text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.stargaze_state where faction_id = fid for update;
  if not found or not st.active then raise exception 'no round: сначала сделайте ставку'; end if;
  if p_idx is null or p_idx < 0 or p_idx > 48 then raise exception 'bad cell'; end if;
  if exists (select 1 from jsonb_array_elements(st.opened) e where (e->>'i')::int = p_idx) then
    raise exception 'already opened: этот узел Разлома уже прощупан';
  end if;

  cell := st.board -> p_idx;
  mult := 1 + 0.25 * st.extras;
  win  := floor(st.stake * (cell->>'m')::numeric * mult);
  update public.faction_economy set gc = gc + win where faction_id = fid
    returning gc into v_gc;

  op   := st.opened || jsonb_build_object('i', p_idx, 't', cell->>'t',
            'm', (cell->>'m')::numeric, 'win', win);
  done := jsonb_array_length(op) >= st.picks;

  if done then
    select (i - 1)::int into jack_i
      from jsonb_array_elements(st.board) with ordinality a(e, i)
      where e->>'t' = 'nova' limit 1;
    select coalesce(sum((e->>'win')::numeric), 0) into total from jsonb_array_elements(op) e;
    fin := jsonb_build_object('board', st.board, 'opened', op, 'stake', st.stake,
      'extras', st.extras, 'mult', mult, 'won', total,
      'spent', st.stake * (1 + st.extras), 'jackpot_i', jack_i);
    update public.stargaze_state
      set active = false, board = null, opened = '[]'::jsonb, last = fin, updated_at = now()
      where faction_id = fid;
  else
    update public.stargaze_state set opened = op, updated_at = now() where faction_id = fid;
  end if;

  -- Джекпот — событие мира (◈ Хроника сектора). Best-effort, игру не ломает.
  if cell->>'t' = 'nova' then
    begin
      v_nm := coalesce(nullif(public._fac_name(fid), ''), 'Одна из держав');
      perform public._post_life_news(
        '🜂 Разлом посмотрел в ответ: ' || v_nm,
        public._news_pick(array[
          format('Медиумы державы %s нащупали в Разломе живой узел — и оттуда посмотрели в ответ. Стенограммы транса расходятся по псионическим орденам сектора; говорят, гонорар хора не помещается в декларацию.', v_nm),
          format('Псионический хор %s сорвал джекпот: погружались наугад, а из Разлома потянулись навстречу. Академии наперебой скупают права на записи контакта.', v_nm),
          format('%s объявляет о контакте с разумом по ту сторону Разлома. Скептики ворчат «массовый психоз», медиумы державы пересчитывают премию.', v_nm)
        ]),
        'rgba(150,46,210,0.5)',
        jsonb_build_array(fid));
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'i', p_idx, 't', cell->>'t',
    'm', (cell->>'m')::numeric, 'win', win, 'gc', v_gc, 'done', done,
    'opened', op, 'picks', st.picks, 'mult', mult,
    'last', case when done then fin else null end);
end$$;
revoke all on function public.stargaze_pick(int) from public, anon;
grant execute on function public.stargaze_pick(int) to authenticated;
