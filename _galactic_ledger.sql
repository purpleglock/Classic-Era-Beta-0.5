-- ============================================================
-- ЛЕДЖЕР ГАЛАКТИЧЕСКИХ ЭФФЕКТОВ — разовые выплаты/поборы Ассамблеи и Поэмы
-- теперь логируются per-faction и видны в «Обзоре → Казна».
-- Применять в Supabase → SQL Editor ПОСЛЕ _vn_assembly.sql и _vn_poem.sql
-- (перекатывает _asm_law_apply и _poem_apply_effect). Идемпотентно.
--
-- Техника: снапшот gc/science/tnp всех держав ДО эффекта → эффект (формулы
-- нетронуты, копия текущих) → дифф ПОСЛЕ пишется в galactic_ledger. Так
-- зеркалится любая формула, включая пер-фракционное «Колесо хаоса».
-- ============================================================

create table if not exists public.galactic_ledger (
  id         bigint generated always as identity primary key,
  faction_id text not null,
  owner_id   uuid,
  source     text not null,               -- 'assembly' | 'poem'
  title      text not null,               -- название закона/эффекта
  d_gc       numeric not null default 0,  -- дельта казны (±ГС)
  d_sci      numeric not null default 0,  -- дельта науки
  d_goods    numeric not null default 0,  -- дельта товаров (tnp)
  created_at timestamptz not null default now()
);
create index if not exists gl_fac_idx on public.galactic_ledger(faction_id, created_at desc);

alter table public.galactic_ledger enable row level security;
revoke all on public.galactic_ledger from anon, authenticated;
grant select on public.galactic_ledger to authenticated;
drop policy if exists "gl_sel" on public.galactic_ledger;
create policy "gl_sel" on public.galactic_ledger for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Общий хвост: дифф снапшота → леджер + обрезка истории до 24 записей ──
create or replace function public._gal_ledger_flush(p_source text, p_title text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.galactic_ledger(faction_id, owner_id, source, title, d_gc, d_sci, d_goods)
    select e.faction_id, e.owner_id, p_source, p_title,
           e.gc - s.gc, e.science - s.science, e.tnp - s.tnp
    from public.faction_economy e
    join pg_temp._gal_snap s on s.faction_id = e.faction_id
    where e.gc <> s.gc or e.science <> s.science or e.tnp <> s.tnp;
  drop table if exists pg_temp._gal_snap;
  delete from public.galactic_ledger gl
    where gl.id not in (select x.id from public.galactic_ledger x
                        where x.faction_id = gl.faction_id
                        order by x.created_at desc, x.id desc limit 24);
end$$;
revoke all on function public._gal_ledger_flush(text, text) from public, anon, authenticated;

create or replace function public._gal_ledger_snap()
returns void language plpgsql security definer set search_path=public as $$
begin
  drop table if exists pg_temp._gal_snap;
  create temp table _gal_snap as
    select faction_id, gc, science, tnp from public.faction_economy;
end$$;
revoke all on function public._gal_ledger_snap() from public, anon, authenticated;

-- ── Ассамблея: _asm_law_apply v2 — формулы из _vn_assembly.sql БЕЗ изменений,
--    добавлены только снапшот и дифф-запись в леджер. ──
create or replace function public._asm_law_apply(p_law jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public._gal_ledger_snap();
  -- pg_safeupdate (session-preload в Supabase) требует WHERE → ставим where true
  case p_law->>'id'
    when 'fed_trade'   then update public.faction_economy set gc = gc + least(2500, greatest(100, round(gc * 0.01))) where true;
    when 'fed_science' then update public.faction_economy set science = science + 25 where true;
    when 'fed_goods'   then update public.faction_economy set tnp = tnp + 20 where true;
    when 'fed_grant'   then update public.faction_economy set gc = gc + 400 where true;
    when 'fed_dual'    then update public.faction_economy set gc = gc + 200, science = science + 12 where true;
    when 'fed_amnesty' then update public.faction_economy set gc = gc + least(1800, greatest(80, round(gc * 0.007))) where true;
    when 'gal_tax'     then update public.faction_economy set gc = greatest(0, gc - least(2500, greatest(100, round(gc * 0.01)))) where true;
    when 'gal_censor'  then update public.faction_economy set science = greatest(0, science - 15) where true;
    when 'gal_requis'  then update public.faction_economy set tnp = greatest(0, tnp - 15) where true;
    when 'gal_levy'    then update public.faction_economy set gc = greatest(0, gc - 300) where true;
    when 'gal_darktax' then update public.faction_economy set gc = greatest(0, gc - least(1800, greatest(80, round(gc * 0.007)))) where true;
    when 'gal_double'  then update public.faction_economy set gc = greatest(0, gc - 200), science = greatest(0, science - 8) where true;
    else null;
  end case;
  perform public._gal_ledger_flush('assembly', coalesce(p_law->>'title', 'Закон Ассамблеи'));
end$$;
revoke all on function public._asm_law_apply(jsonb) from public, anon, authenticated;

-- ── Поэма: _poem_apply_effect v2 — копия _vn_poem.sql, снапшот перед case,
--    дифф-запись после (ранние выходы «эффекта нет» леджер не трогают). ──
create or replace function public._poem_apply_effect(p_week date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_theme text; v_cnt int; v_score int; v_oppo text; v_ocnt int := 0;
  v_strofa boolean := false; v_mult numeric := 1.0; v_note text := ''; v_fx jsonb;
begin
  select w.theme, count(*) into v_theme, v_cnt
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = p_week and d.resolved
  group by w.theme
  order by count(*) desc, md5(p_week::text || w.theme)
  limit 1;

  if v_theme is null or v_cnt < 3 then
    return jsonb_build_object('theme', 'mixed', 'tone', 'none', 'mult', 1,
      'title', 'Разноголосица',
      'descr', 'Стих вышел пёстрым — галактика пожала плечами. Эффекта нет.');
  end if;

  -- антипод гасит: эффективный счёт = свои строки − строки темы-антипода
  v_oppo := public._poem_oppo(v_theme);
  select count(*) into v_ocnt
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = p_week and d.resolved and w.theme = v_oppo;
  v_score := v_cnt - coalesce(v_ocnt, 0);
  if v_score < 3 then
    return jsonb_build_object('theme', v_theme, 'tone', 'none', 'mult', 1, 'vs', v_oppo,
      'title', 'Спор тем',
      'descr', format('«%s» (%s стр.) столкнулась со своим антиподом — «%s» (%s стр.). Голоса взаимно погасли, эффекта нет.',
        public._poem_theme_ru(v_theme), v_cnt, public._poem_theme_ru(v_oppo), v_ocnt));
  end if;

  -- «строфа сложилась»: хотя бы одна строфа (I–II / III–IV / V–VII) целиком за доминантой
  select exists (
    select 1
    from public.poem_days d join public.poem_words w on w.id = d.winner_word
    where d.week_start = p_week and d.resolved
    group by public._poem_group(d.day_idx)
    having bool_and(w.theme = v_theme)
       and count(*) = (case when min(d.day_idx) >= 4 then 3 else 2 end)
  ) into v_strofa;
  if v_strofa then
    v_mult := 1.5;
    v_note := ' Строфа сложилась в один голос — эффект усилен в полтора раза.';
  end if;

  perform public._gal_ledger_snap();

  -- Числа скромные: это символический недельный штрих, а не источник дохода.
  case v_theme
    when 'hope' then
      update public.faction_economy
        set gc = gc + least(round(3000 * v_mult), greatest(round(100 * v_mult), round(gc * 0.005 * v_mult)));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Прилив надежды',
        'descr', 'Казна каждой державы выросла на 0.5% (от 100 до 3 000 ГС).' || v_note);
    when 'wealth' then
      update public.faction_economy set gc = gc + round(500 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Золотая неделя',
        'descr', 'Каждая держава получила 500 ГС.' || v_note);
    when 'knowledge' then
      update public.faction_economy set science = science + round(30 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Век просвещения',
        'descr', 'Каждая держава получила 30 очков науки.' || v_note);
    when 'love' then
      update public.faction_economy set tnp = tnp + round(30 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Узы единства',
        'descr', 'Каждая держава получила 30 товаров.' || v_note);
    when 'space' then
      update public.faction_economy set gc = gc + round(150 * v_mult), science = science + round(15 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Зов горизонта',
        'descr', 'Каждая держава получила 150 ГС и 15 очков науки.' || v_note);
    when 'war' then
      update public.faction_economy
        set gc = greatest(0, gc - least(round(2000 * v_mult), greatest(round(100 * v_mult), round(gc * 0.005 * v_mult))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Мобилизация',
        'descr', 'Военные приготовления съели 0.5% казны каждой державы (от 100 до 2 000 ГС).' || v_note);
    when 'dark' then
      update public.faction_economy
        set gc = greatest(0, gc - least(round(4000 * v_mult), greatest(round(200 * v_mult), round(gc * 0.01 * v_mult))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Тень над сектором',
        'descr', 'Упадок духа: −1% казны каждой державы (от 200 до 4 000 ГС).' || v_note);
    when 'chaos' then
      update public.faction_economy
        set gc = greatest(0, gc - round(200 * v_mult)
          + public._poem_hash(p_week::text || faction_id) % (round(801 * v_mult))::int);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Колесо хаоса',
        'descr', 'Каждой державе выпал свой жребий: от −200 до +600 ГС.' || v_note);
    else
      v_fx := jsonb_build_object('theme', 'mixed', 'tone', 'none', 'title', 'Разноголосица',
        'descr', 'Эффекта нет.');
  end case;

  perform public._gal_ledger_flush('poem', coalesce(v_fx->>'title', 'Поэма недели'));
  return v_fx || jsonb_build_object('mult', v_mult);
end$$;
revoke all on function public._poem_apply_effect(date) from public, anon, authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select * from public.galactic_ledger order by created_at desc limit 20;
-- После следующего закона Ассамблеи / итога поэмы здесь появятся строки
-- per-faction, а «Обзор → Казна» покажет блок «🌌 Галактические эффекты».
