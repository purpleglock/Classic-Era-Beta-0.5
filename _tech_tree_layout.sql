-- ============================================================
-- РАСКЛАДКА ДЕРЕВА ИССЛЕДОВАНИЙ (PoE-стиль) — позиции + иконки + картинки
--
-- Косметический слой поверх каталога tech_nodes: где узел стоит на холсте
-- (x,y), какой у него emoji-значок и картинка. Сам каталог (id/цена/prereq)
-- НЕ трогаем — он остаётся источником истины цены и зависимостей.
--
-- Паттерн как у карты галактики (map_systems): staff тащит узлы в режиме
-- редактора, позиция сохраняется в Supabase; игроки видят раскладку только
-- на чтение. Узлы без сохранённой позиции авто-раскидываются на клиенте.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _security_research.sql. Идемпотентно.
-- ============================================================

create table if not exists public.tech_layout (
  node_id    text primary key,
  x          numeric,
  y          numeric,
  icon       text,
  img        text,
  nocore     boolean not null default false,   -- корень откреплён от ядра «НАУКА» (спица не рисуется)
  updated_at timestamptz not null default now()
);

-- докинуть колонку на уже существующей таблице (идемпотентно)
alter table public.tech_layout add column if not exists nocore boolean not null default false;

alter table public.tech_layout enable row level security;

-- Раскладка — не секрет: читают все (каталог технологий).
drop policy if exists "tl_sel" on public.tech_layout;
create policy "tl_sel" on public.tech_layout for select to public using (true);

-- Прямой DML — только staff (на всякий случай; основной путь записи — RPC ниже).
drop policy if exists "tl_write" on public.tech_layout;
create policy "tl_write" on public.tech_layout for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Upsert одной позиции/иконки/картинки (staff) ─────────────
-- p_icon / p_img: NULL = не трогать поле; '' = очистить; иначе — записать.
-- p_x / p_y: NULL = не трогать (можно сохранять только картинку, не двигая).
-- p_nocore: NULL = не трогать; true/false = открепить/прицепить корень к ядру.
create or replace function public.tech_layout_set(
  p_node text, p_x numeric default null, p_y numeric default null,
  p_icon text default null, p_img text default null, p_nocore boolean default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;

  insert into public.tech_layout(node_id, x, y, icon, img, nocore, updated_at)
    values (p_node, p_x, p_y, nullif(p_icon,''), nullif(p_img,''), coalesce(p_nocore,false), now())
  on conflict (node_id) do update set
    x      = coalesce(excluded.x, public.tech_layout.x),
    y      = coalesce(excluded.y, public.tech_layout.y),
    icon   = case when p_icon is null then public.tech_layout.icon else nullif(p_icon,'') end,
    img    = case when p_img  is null then public.tech_layout.img  else nullif(p_img,'')  end,
    nocore = coalesce(p_nocore, public.tech_layout.nocore),
    updated_at = now();
end$$;
-- старую 5-арг сигнатуру убираем, чтобы не висели две перегрузки
drop function if exists public.tech_layout_set(text,numeric,numeric,text,text);
revoke all on function public.tech_layout_set(text,numeric,numeric,text,text,boolean) from public;
grant execute on function public.tech_layout_set(text,numeric,numeric,text,text,boolean) to authenticated;

-- ── Сброс раскладки узла (вернуть к авто-раскладке) ─────────
create or replace function public.tech_layout_reset(p_node text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  delete from public.tech_layout where node_id = p_node;
end$$;
revoke all on function public.tech_layout_reset(text) from public;
grant execute on function public.tech_layout_reset(text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select * from public.tech_layout order by updated_at desc;
-- select public.tech_layout_set('cls.ship.frigate', 100, 200, '🛰', null);
