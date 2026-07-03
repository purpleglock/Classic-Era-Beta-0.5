# Вход только через Google — настройка (делается руками в консолях)

Клиент уже готов (`?v=20260703privacy`): кнопка «Войти через Google», PKCE-обмен
`?code=` в `auth.js`, пароль-формы удалены. Чтобы это заработало и стало
ЕДИНСТВЕННЫМ входом, нужно 3 шага в внешних консолях.

## 1. Google Cloud Console (console.cloud.google.com)
1. Создать проект (или взять существующий) → **APIs & Services → OAuth consent screen**:
   - User type: External, имя приложения, ваш email;
   - Publishing status: **In production** (иначе входить смогут только тестовые пользователи).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**;
   - Authorized JavaScript origins:
     - `https://<ваш-домен-vercel>` (прод)
     - `http://localhost:8000` (локальная отладка, если нужна)
   - Authorized redirect URIs:
     - `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
       (точный URL показывает Supabase на странице провайдера Google)
3. Скопировать **Client ID** и **Client Secret**.

## 2. Supabase Dashboard → Authentication
1. **Providers → Google**: Enable, вставить Client ID + Client Secret, Save.
2. **URL Configuration**:
   - Site URL: `https://<ваш-домен-vercel>`;
   - Redirect URLs (allowlist): добавить
     - `https://<ваш-домен-vercel>/`
     - `http://localhost:8000/` (если нужна локальная отладка)
   Клиент шлёт `redirectTo = origin + pathname` — он должен попадать в allowlist.
3. **Отключить вход по паролю** (это и делает Google единственным входом):
   - Providers → **Email**: выключить провайдер целиком
     (или минимум «Disable new user signups» для email, если хотите мягче).

## 3. Связка старых аккаунтов
Supabase сам привязывает Google-identity к существующему аккаунту, если email
совпадает и был подтверждён — user_id сохраняется, прогресс не теряется.
Аккаунты с НЕподтверждённым email привяжутся как новые — таких игроков
при необходимости можно перевесить через админку («Передать государство»).

## Проверка
1. Разлогиниться → «Войти» → кнопка Google → выбрать аккаунт → возврат на сайт
   уже залогиненным (URL на секунду содержит `?code=...`, затем очищается).
2. Первый вход нового игрока → всплывает гейт согласия с документами
   (существующий legal-гейт, `LEGAL_VERSION`).
3. Попытка `POST /auth/v1/signup` с email/паролем должна возвращать ошибку
   (провайдер Email выключен).
