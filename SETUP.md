# Setup

Фронтенд — статический (HTML + JS). Бэкенд — Supabase (БД, Auth, Storage, Edge Functions). Чтобы всё заработало, нужно поднять **свой** Supabase-проект и подставить его ключи в `core.js`.

---

## 1. Создать проект в Supabase

1. Зайти на https://supabase.com → **New project**.
2. Запомнить пароль БД (понадобится для `pg_dump` / SQL Editor).
3. Когда проект создан — открыть **Settings → API**:
   - `Project URL` → пойдёт в `SB_URL`
   - `anon public` key → пойдёт в `SB_ANON`

## 2. Подставить ключи в код

Открыть `core.js`, строки 10–14, заменить плейсхолдеры:

```js
const SB_URL  = 'https://<ТВОЙ-REF>.supabase.co';
const SB_ANON = '<ТВОЙ-ANON-KEY>';
```

> `anon`-ключ предназначен для браузера и сам по себе не секрет — БД защищает **RLS** (см. шаг 4). `service_role` ключ **никогда** не клади в код.

## 3. Создать таблицы

В Dashboard → **SQL Editor** выполнить миграции (получи `schema.sql` у автора репо, либо собери руками — список таблиц ниже).

Используемые таблицы (видно по коду):

| Таблица         | Где используется |
|-----------------|------------------|
| `pages`         | вики-страницы (data.js, editor.js, render.js) |
| `characters`    | персонажи (character.js, editor.js) |
| `factions`      | фракции (faction_system.js) |
| `coefficients`  | коэффициенты (coefficients.js) |
| `comments`      | комментарии (comments.js) |
| `user_roles`    | роли (superadmin / editor / moderator / viewer) — auth.js |
| `settings`      | глобальные настройки |
| `site_settings` | настройки сайта (core.js, editor.js) |
| `images`        | картинки (editor.js) |

## 4. Включить и настроить RLS

В Dashboard → **Authentication → Policies** на каждую таблицу нужно включить **Row Level Security** и завести политики. Минимум:

- `pages`, `characters`, `factions`, `coefficients`, `site_settings`: read — всем; write — только `admin` (через `user_roles`).
- `comments`: read — всем; insert — авторизованным; update/delete — автору или админу.
- `user_roles`: read — только владельцу строки и админам; write — только админам.

Без RLS любой посетитель сможет вайпнуть БД через anon-ключ.

## 5. Создать Storage bucket

Dashboard → **Storage** → **New bucket**:
- имя: `wiki-images`
- **Public** ✅ (фронт грузит файлы по публичным URL — см. `editor.js:2079-2080`)
- policies: upload — авторизованным; read — всем.

## 6. Настроить Auth

Dashboard → **Authentication**:
- Providers → включить **Email** (или то, чем будете логиниться).
- **URL Configuration** → Site URL = адрес, где будет крутиться `index.html` (GitHub Pages / Netlify / `http://localhost:5500` для разработки).

## 7. Создать первого админа

1. Открой `index.html` в браузере, зарегистрируйся через форму.
2. Узнай свой `user_id` (Dashboard → Authentication → Users).
3. В SQL Editor:

```sql
insert into user_roles (user_id, role, is_banned)
values ('<твой-uuid>', 'superadmin', false);
```

Перелогинься — теперь у тебя доступ к редактору.

## 8. Запустить сайт

Сайт статический, бэкенда нет. Варианты:

- **GitHub Pages**: запушить репо → Settings → Pages → Source: main / root.
- **Netlify / Cloudflare Pages**: drag-and-drop папки, либо подключить репо.
- **Локально для разработки**: любой статик-сервер, например
  ```bash
  npx serve .
  ```
  Просто открывать `index.html` двойным кликом тоже работает, но Supabase Auth корректнее ведёт себя через `http://`.

⚠️ Адрес сайта добавь в Supabase → Authentication → URL Configuration → **Site URL** и **Redirect URLs**, иначе логин будет редиректить не туда.

---

## Чек-лист «всё ли работает»

- [ ] Открыл сайт, не падает в консоли.
- [ ] Зарегался → попал внутрь.
- [ ] Назначил себе `superadmin` в `user_roles` → видишь редактор.
- [ ] Создал тестовую страницу → она сохранилась (проверь таблицу `pages`).
- [ ] Загрузил картинку в редакторе → она появилась в bucket `wiki-images`.
- [ ] Оставил комментарий → запись в `comments`.

Если что-то ломается — открой DevTools → Network, посмотри ответ от `*.supabase.co`. Чаще всего это RLS отказывает в доступе.
