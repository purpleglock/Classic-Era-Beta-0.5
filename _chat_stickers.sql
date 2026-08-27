-- ════════════════════════════════════════════════════════════════════════
--  ЧАТ: СТИКЕРЫ С ПОДПИСЬЮ И ФЛАГОМ ОТПРАВИТЕЛЯ
--
--  ЧТО ЭТО. Стикер — не просто картинка: это рамка, в которую при отправке
--  подставляется ФЛАГ ДЕРЖАВЫ отправителя (faction_applications.herald_url) и
--  подпись. Один и тот же стикер у двух игроков выглядит по-разному — это и
--  есть смысл затеи, иначе хватило бы папки с гифками.
--
--  ⚠️ КАРТИНКА ЖИВЁТ В ФАЙЛАХ, А НЕ В БАЗЕ. Как все арты проекта: залил
--  батником `tools/stickers.bat` (или админкой) в `assets/stickers/<key>.webp`,
--  здесь лежит только КЛЮЧ и раскладка. Так стикеры попадают в dist вместе с
--  остальными артами и не жрут трафик базы.
--
--  ⚠️ КООРДИНАТЫ — ДОЛИ (0..1), НЕ ПИКСЕЛИ. Стикер рисуется и в ленте (220 px),
--  и в палитре (64 px), и на телефоне: пиксельная раскладка разъехалась бы на
--  каждом размере. В долях она одна для всех.
--
--  СТРОЕНИЕ cfg:
--    text: {on, mode, x, y, w, size, align, font, color, stroke, rot, caps}
--          mode: 'author' — подпись пишет отправитель (по умолчанию),
--                'fixed'  — подпись задана в админке и не меняется,
--                'name'   — подставляется ник отправителя.
--          x/y — левый верхний угол блока, w — ширина; size — доля ВЫСОТЫ
--          стикера (кегль), поэтому текст масштабируется вместе с картинкой.
--    flag: {on, x, y, w, h, rot, fit} — окно под флаг державы. fit: 'cover'
--          (заполнить, обрезав) или 'contain' (вписать целиком).
--
--  ПРАВА. Читают все вошедшие (стикеры общие), правит только администрация:
--  раскладка — часть оформления игры, а не имущество игрока.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.chat_stickers (
  key        text primary key,                 -- имя файла без расширения: assets/stickers/<key>.webp
  name       text not null default '',         -- как зовём в палитре
  pack       text not null default 'Общие',    -- раздел палитры
  ext        text not null default 'webp',
  ord        int  not null default 100,
  enabled    boolean not null default true,
  cfg        jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_stickers_ord_idx on public.chat_stickers(enabled, ord, key);

alter table public.chat_stickers enable row level security;

drop policy if exists "chst_sel" on public.chat_stickers;
create policy "chst_sel" on public.chat_stickers for select to authenticated using (true);

drop policy if exists "chst_all" on public.chat_stickers;
create policy "chst_all" on public.chat_stickers for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

grant select on public.chat_stickers to authenticated;
grant insert, update, delete on public.chat_stickers to authenticated;

create or replace function public.chat_stickers_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists chat_stickers_touch_tg on public.chat_stickers;
create trigger chat_stickers_touch_tg before update on public.chat_stickers
  for each row execute function public.chat_stickers_touch();

-- ── Сообщение-стикер ────────────────────────────────────────────────────
-- st  — ключ стикера, sflag — СНИМОК флага на момент отправки.
-- ⚠️ Флаг именно снимком, а не ссылкой на державу: игрок меняет герб, уходит
-- из державы, державу сносят — а стикер в истории должен остаться таким, каким
-- его отправили. Иначе вчерашняя шутка завтра переобувается в чужой флаг.
alter table public.chat_messages add column if not exists st    text;
alter table public.chat_messages add column if not exists sflag text;

-- Подпись стикера едет в body (там же лимит и та же модерация), поэтому
-- отдельной колонки под текст нет — тело у стикера просто короткое.

-- Заготовка раскладки: половина стикеров — «персонаж с флагом на груди»,
-- поэтому по умолчанию флаг в правом нижнем углу, подпись — снизу во всю ширину.
create or replace function public.chat_sticker_default_cfg() returns jsonb
language sql immutable as $$
  select '{
    "text": {"on": true, "mode": "author", "x": 0.06, "y": 0.72, "w": 0.88,
             "size": 0.13, "align": "center", "font": "poster", "color": "#ffffff",
             "stroke": "#000000", "rot": 0, "caps": true},
    "flag": {"on": true, "x": 0.62, "y": 0.62, "w": 0.3, "h": 0.3, "rot": 0, "fit": "cover"}
  }'::jsonb
$$;
grant execute on function public.chat_sticker_default_cfg() to authenticated;
