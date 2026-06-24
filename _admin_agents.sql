-- ============================================================
-- АДМИН · ВЫДАЧА И КАСТОМИЗАЦИЯ АГЕНТОВ (консоль управления)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents5.sql. Идемпотентно.
--
-- Запись в spy_agents идёт через SECURITY DEFINER (RLS не пускает прямой insert),
-- доступ только стаффу (superadmin/editor). owner_id агента = владелец фракции,
-- чтобы агент сразу был виден в её кабинете. Агенты выдаются готовыми (ready_at=now).
-- ============================================================

create or replace function public.admin_grant_agent(p_fid text, p_first text, p_last text, p_perk text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare oid uuid; new_id uuid; frace text; fgender text;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  if p_perk not in ('infiltrator','saboteur','ghost','analyst','handler') then raise exception 'bad perk'; end if;
  select owner_id, race into oid, frace from public.faction_applications
    where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  -- пол случайный (раса = раса фракции, как у нанятых рекрутов)
  fgender := (array['муж.','жен.','агендер'])[1 + floor(random()*3)::int];
  insert into public.spy_agents(faction_id, owner_id, first_name, last_name, perk, ready_at, race, gender)
    values(p_fid, oid, coalesce(nullif(btrim(p_first),''),'Агент'),
                       coalesce(nullif(btrim(p_last),''),'—'), p_perk, now(), frace, fgender)
    returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id);
end$$;
revoke all on function public.admin_grant_agent(text,text,text,text) from public;
grant execute on function public.admin_grant_agent(text,text,text,text) to authenticated;

create or replace function public.admin_set_agent(p_id uuid, p_first text, p_last text, p_perk text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  if p_perk is not null and p_perk not in ('infiltrator','saboteur','ghost','analyst','handler') then raise exception 'bad perk'; end if;
  update public.spy_agents set
      first_name = coalesce(nullif(btrim(p_first),''), first_name),
      last_name  = coalesce(nullif(btrim(p_last),''),  last_name),
      perk       = coalesce(p_perk, perk)
    where id = p_id;
  if not found then raise exception 'agent not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.admin_set_agent(uuid,text,text,text) from public;
grant execute on function public.admin_set_agent(uuid,text,text,text) to authenticated;

create or replace function public.admin_remove_agent(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  delete from public.spy_agents where id = p_id;
  if not found then raise exception 'agent not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.admin_remove_agent(uuid) from public;
grant execute on function public.admin_remove_agent(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- admin_grant_agent('<fid>','Имя','Фамилия','infiltrator') → агент в ростере фракции.
