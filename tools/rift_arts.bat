@echo off
chcp 65001 >nul
rem ══════════════════════════════════════════════════════════════════
rem  Арты призов «Всмотреться в Разлом».
rem  Перетащи файлы картинок НА этот батник — они лягут в assets\rift\.
rem  Имена строго такие (webp / png / jpg / gif):
rem    nova_1    — Взгляд в ответ (джекпот), 1 узел на поле
rem    quasar_1  — Псионический маяк,        2 узла
rem    comet_1   — Эхо Разлома,              4 узла
rem    photo_1   — Видение,                  8 узлов
rem    dust_1    — Белый шум,               34 узла
rem  Артов на тип можно сколько угодно: nova_1, nova_2, nova_3 …
rem  НУМЕРАЦИЯ БЕЗ ПРОПУСКОВ — клиент ищет подряд и на первой дыре
rem  останавливается (есть _1 и _3, но нет _2 → увидит только _1).
rem  Файла нет — узел рисует иконку, ничего не ломается.
rem  После заливки: git add assets\rift, коммит, деплой.
rem ══════════════════════════════════════════════════════════════════
setlocal
set "DEST=%~dp0..\assets\rift"
if not exist "%DEST%" mkdir "%DEST%"
if "%~1"=="" (
  echo Перетащи картинки на этот файл. Папка назначения: %DEST%
  echo Имена: nova_1 quasar_1 comet_1 photo_1 dust_1 ... ^(.webp/.png/.jpg/.gif^)
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
