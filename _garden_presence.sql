-- ============================================================
-- САД: ВИДЕТЬ ДРУГИХ САДОВОДОВ
-- ============================================================
-- До сих пор «одновременно» значило «рядом, но вслепую»: данные не
-- конфликтовали, но чужой корабль в кадре не появлялся никогда, и обод Храма
-- читался пустым складом, даже когда на нём работали шестеро.
--
-- ⚠️ ПРИСУТСТВИЕ — ЭТО НЕ ИСТОРИЯ, А СЛЕПОК «ГДЕ Я СЕЙЧАС». Поэтому одна
-- строка на владельца (upsert), а не поток событий: журнал точек по секунде на
-- каждого игрока — это мусор на гигабайты и лишний диск ради того, что живёт
-- полторы секунды. Строки старше пяти минут выметаются тут же, при пинге.
--
-- Отдаём ТОЛЬКО то, что и так видно глазами: место, курс, шляпа, расцветка,
-- имя державы и её цвет. Ни времени в сети, ни счётов, ни того, кто чем занят.
-- ============================================================

create table if not exists public.garden_presence (
  owner_id   uuid primary key,
  faction_id text,
  sys        text,
  tx         double precision,
  ty         double precision,
  ang        real,
  hat        text,
  hull       text,
  seen_at    timestamptz not null default now()
);
create index if not exists garden_presence_sys on public.garden_presence(sys, seen_at);

alter table public.garden_presence enable row level security;
drop policy if exists "gpres_sel" on public.garden_presence;
-- Читать может любой вошедший: это и есть смысл присутствия.
create policy "gpres_sel" on public.garden_presence for select to authenticated using (true);
revoke insert, update, delete on public.garden_presence from public, anon, authenticated;

-- ── Пинг: положил себя, забрал остальных. ──
-- Одним вызовом, а не двумя: иначе на каждого игрока каждую секунду уходит по
-- два обращения к базе, и половина из них — впустую.
create or replace function public.garden_ping(
  p_tx double precision, p_ty double precision, p_ang real default 0,
  p_hat text default null, p_hull text default null, p_sys text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_sys text; v jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  v_sys := coalesce(nullif(btrim(coalesce(p_sys,'')),''), public._g_temple_sys());
  if v_sys is null then raise exception 'нет системы'; end if;

  insert into public.garden_presence(owner_id, faction_id, sys, tx, ty, ang, hat, hull, seen_at)
  values (auth.uid(), fid, v_sys, p_tx, p_ty, coalesce(p_ang,0),
          left(coalesce(p_hat,'straw'), 12), left(coalesce(p_hull,'steel'), 12), now())
  on conflict (owner_id) do update
     set faction_id = excluded.faction_id, sys = excluded.sys,
         tx = excluded.tx, ty = excluded.ty, ang = excluded.ang,
         hat = excluded.hat, hull = excluded.hull, seen_at = now();

  -- Уборка старья. Дешевле держать таблицу маленькой, чем фильтровать её
  -- по времени в каждом чтении: играющих единицы, а строки копятся вечно.
  delete from public.garden_presence where seen_at < now() - interval '5 minutes';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',   md5(gp.owner_id::text),          -- чужой uuid наружу не отдаём
           'fid',  gp.faction_id,
           'nm',   coalesce(fa.name, 'Безымянные'),
           'col',  coalesce(fa.color, '#6f8bb5'),
           'tx',   gp.tx, 'ty', gp.ty, 'ang', gp.ang,
           'hat',  gp.hat, 'hull', gp.hull)), '[]'::jsonb)
    into v
    from public.garden_presence gp
    left join lateral (
      select name, color from public.faction_applications
       where faction_id = gp.faction_id and status = 'approved' limit 1) fa on true
   where gp.sys = v_sys
     and gp.owner_id <> auth.uid()
     and gp.seen_at > now() - interval '25 seconds';

  return jsonb_build_object('ok', true, 'peers', coalesce(v, '[]'::jsonb));
end$$;
revoke all on function public.garden_ping(double precision, double precision, real, text, text, text) from public, anon;
grant execute on function public.garden_ping(double precision, double precision, real, text, text, text) to authenticated;

-- ── Уход: строку сносим сразу, а не ждём пять минут. ──
create or replace function public.garden_bye()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  delete from public.garden_presence where owner_id = auth.uid();
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.garden_bye() from public, anon;
grant execute on function public.garden_bye() to authenticated;
