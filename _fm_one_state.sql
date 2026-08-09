-- ============================================================
-- СЛУЖБА — ТОЛЬКО ОДНОЙ ДЕРЖАВЕ + ДОСЬЕ ПЕРСОНАЖА В ЗАЯВКЕ
-- Применять: node tools/db_run.js _fm_one_state.sql
-- Порядок: ПОСЛЕ _faction_members.sql (переопределяет fm_apply/fm_list/fm_me).
--
-- Было: висящих заявок можно было насыпать сколько угодно — по одной на
-- каждую державу. Стало: заявка ровно одна, как и служба. Хочешь другую
-- державу — сначала отзови текущую заявку.
--
-- Второе: к заявке цепляется персонаж (страница-досье из мастера
-- регистрации). Владелец видит, КОГО берёт на службу, а не строку из prompt.
-- ============================================================

alter table public.faction_members add column if not exists char_slug text;

-- Схлопываем накопленные множественные заявки: оставляем самую раннюю.
update public.faction_members m set status = 'left', updated_at = now()
 where m.status = 'pending'
   and m.id <> (select x.id from public.faction_members x
                 where x.user_id = m.user_id and x.status = 'pending'
                 order by x.created_at asc, x.id asc limit 1);

-- Одна висящая заявка на игрока (раньше индекс был на пару игрок↔держава).
drop index if exists public.fm_one_pending;
create unique index if not exists fm_one_pending on public.faction_members(user_id) where status = 'pending';

-- ── Подать заявку в державу ─────────────────────────────────
create or replace function public.fm_apply(p_fid text, p_note text default null, p_char text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare nm text; v_id uuid; cur text;
begin
  if auth.uid() is null then raise exception 'не авторизован'; end if;
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if public._fm_own_fid() is not null then
    raise exception 'у вас своя держава — сначала откажитесь от неё, чтобы служить чужой';
  end if;
  if public._fm_member_fid() is not null then
    raise exception 'вы уже служите державе — сначала выйдите из состава';
  end if;
  select faction_id into cur from public.faction_members
    where user_id = auth.uid() and status = 'pending' limit 1;
  if cur is not null then
    if cur = p_fid then raise exception 'заявка в эту державу уже подана — ждите решения владельца'; end if;
    raise exception 'служить можно только одной державе: сначала отзовите заявку в «%»',
      coalesce((select a.name from public.faction_applications a
                  where a.faction_id = cur and a.status='approved' limit 1), cur);
  end if;
  select name into nm from public.faction_applications
    where faction_id = p_fid and status = 'approved' limit 1;
  if nm is null then raise exception 'держава не найдена'; end if;
  -- Повторная заявка после отказа/ухода: оживляем старую строку.
  update public.faction_members
     set status='pending', note=left(coalesce(p_note,''),1000),
         char_slug=nullif(p_char,''), updated_at=now()
   where user_id = auth.uid() and faction_id = p_fid and status in ('rejected','left','kicked')
   returning id into v_id;
  if v_id is null then
    insert into public.faction_members(faction_id, user_id, note, char_slug)
      values (p_fid, auth.uid(), left(coalesce(p_note,''),1000), nullif(p_char,''))
      returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'faction_name', nm);
end$$;

-- Старую двухаргументную версию убираем, чтобы клиент не звал её мимо персонажа.
drop function if exists public.fm_apply(text, text);

-- ── Состав и заявки моей державы: + досье персонажа ─────────
create or replace function public.fm_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._fm_owner_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'user_id', m.user_id, 'status', m.status,
      'role', m.role, 'role_title', public._fm_role_title(m.role),
      'role_perms', to_jsonb(public._fm_role_perms(m.role)),
      'perms', m.perms, 'scope_all', m.scope_all, 'scope', m.scope,
      'note', m.note, 'created_at', m.created_at,
      'char_slug', m.char_slug,
      'char_name', ch.name, 'char_class', ch.class,
      'name', coalesce(nullif(ch.name,''), nullif(p.display_name,''),
                       nullif(split_part(coalesce(p.email,''), '@', 1),''), 'Игрок'),
      'avatar_url', p.avatar_url)
      order by (m.status='pending') desc, m.created_at asc)
    from public.faction_members m
    left join public.profiles p on p.user_id = m.user_id
    left join public.characters ch on ch.slug = m.char_slug
    where m.faction_id = fid and m.status in ('pending','active')
  ), '[]'::jsonb);
end$$;

-- ── Мой статус: + персонаж в висящей заявке и на службе ─────
create or replace function public.fm_me()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.faction_members; own text; pend jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('anon', true); end if;
  own := public._fm_own_fid();
  m   := public._fm_my_row();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'faction_id', r.faction_id, 'created_at', r.created_at,
           'char_slug', r.char_slug,
           'faction_name', (select a.name from public.faction_applications a
                              where a.faction_id = r.faction_id and a.status='approved' limit 1))), '[]'::jsonb)
    into pend from public.faction_members r
    where r.user_id = auth.uid() and r.status = 'pending';
  return jsonb_build_object(
    'own_fid', own,
    'is_owner', own is not null,
    'inbox', case when own is null then 0 else
      (select count(*) from public.faction_members r
         where r.faction_id = own and r.status = 'pending') end,
    'membership', case when m.id is null then null else jsonb_build_object(
        'id', m.id, 'faction_id', m.faction_id, 'role', m.role,
        'role_title', public._fm_role_title(m.role),
        'scope_all', m.scope_all, 'scope', m.scope, 'char_slug', m.char_slug,
        'faction_name', (select a.name from public.faction_applications a
                           where a.faction_id = m.faction_id and a.status='approved' limit 1),
        'faction_color', (select a.color from public.faction_applications a
                            where a.faction_id = m.faction_id and a.status='approved' limit 1),
        'herald_url', (select a.herald_url from public.faction_applications a
                         where a.faction_id = m.faction_id and a.status='approved' limit 1)) end,
    'perms', to_jsonb(public._fm_my_perms()),
    'pending', pend);
end$$;

grant execute on function public.fm_apply(text,text,text) to authenticated;
grant execute on function public.fm_list() to authenticated;
grant execute on function public.fm_me()   to authenticated;
