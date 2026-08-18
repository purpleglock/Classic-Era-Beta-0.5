-- ============================================================
-- САД: СВОЙ ID ДЛЯ ВЕБСОКЕТА
-- ============================================================
-- Присутствие поехало по вебсокету (канал `garden:<sys>`, broadcast 8 раз в
-- секунду), а garden_ping остался редким страховочным слепком в БД. Оба
-- источника кладут в одну корзину — и корабль двоился: по проводу он приходил
-- под одним ключом, из базы под другим (md5 чужого uuid).
--
-- Чтобы склеить, игроку нужно знать СВОЙ ключ в той же системе счисления.
-- Отдаём только его собственный — чужие uuid наружу по-прежнему не уходят.
-- ============================================================

create or replace function public.garden_ping(
  p_tx double precision, p_ty double precision, p_ang real default 0,
  p_hat text default null, p_hull text default null, p_sys text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_sys text; v jsonb; v_me jsonb;
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

  delete from public.garden_presence where seen_at < now() - interval '5 minutes';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',   md5(gp.owner_id::text),
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

  -- Мой паспорт: тем же ключом подписываюсь в вебсокете, и имя с цветом
  -- державы берём с сервера, а не гадаем на клиенте.
  select jsonb_build_object(
           'id',  md5(auth.uid()::text),
           'fid', fid,
           'nm',  coalesce(fa.name, 'Безымянные'),
           'col', coalesce(fa.color, '#6f8bb5'),
           'sys', v_sys)
    into v_me
    from (select 1) z
    left join lateral (
      select name, color from public.faction_applications
       where faction_id = fid and status = 'approved' limit 1) fa on true;

  return jsonb_build_object('ok', true, 'me', v_me, 'peers', coalesce(v, '[]'::jsonb));
end$$;
revoke all on function public.garden_ping(double precision, double precision, real, text, text, text) from public, anon;
grant execute on function public.garden_ping(double precision, double precision, real, text, text, text) to authenticated;
