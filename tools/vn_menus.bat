@echo off
chcp 65001 >nul
rem ══════════════════════════════════════════════════════════════════
rem  Арт-подложки экранов новеллы (бойцовский клуб, разлом, рейтинг…).
rem  Перетащи файлы картинок НА этот батник — они лягут в assets\vn\menu\.
rem  Имя файла = экран (строго так, .webp / .png / .jpg):
rem    fight     — 🥊 Бойцовский клуб        sinli    — ⛓ Синли-бей
rem    tama      — Тама                      fish     — 🎣 Рыбалка
rem    intel     — 🕵 Разведуправление       geo      — Георазведка
rem    stars     — Stargaze                  doom     — Длань Неотвратимости
rem    poem      — Галактическая поэма       assembly — 🏛 Ассамблея
rem    rating    — Рейтинг держав            research — Исследования
rem    planets   — Планеты
rem  Кадр широкий (от 1600 px, ~16:9). Картинка растворяется книзу маской —
rem  ВЕРХ кадра уходит под шапку экрана, низ под текст: важное держи в центре.
rem  Файла нет — экран рисует родной градиент, ничего не ломается.
rem  После заливки: git add assets\vn\menu, коммит, деплой.
rem ══════════════════════════════════════════════════════════════════
setlocal
set "DEST=%~dp0..\assets\vn\menu"
if not exist "%DEST%" mkdir "%DEST%"
if "%~1"=="" (
  echo Перетащи картинки на этот файл. Папка назначения: %DEST%
  echo Имена: fight sinli tama fish intel geo stars doom poem assembly rating research planets
  start "" "%DEST%"
  pause
  exit /b 0
)
:loop
if "%~1"=="" goto done
copy /y "%~1" "%DEST%\%~nx1" >nul && echo [OK] %~nx1 || echo [FAIL] %~nx1
shift
goto loop
:done
echo.
echo Готово. Проверь имена файлов в %DEST% и задеплой (папка assets\ попадает в dist).
pause
