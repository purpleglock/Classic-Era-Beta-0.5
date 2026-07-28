@echo off
chcp 65001 >nul
rem ══════════════════════════════════════════════════════════════════
rem  Шапки-арты новеллы «Разведуправление».
rem  Перетащи файлы картинок НА этот батник — они лягут в assets\intel\.
rem  Имена строго такие (webp / png / jpg):
rem    ops       — Операции (оперативный отдел)
rem    agents    — Агентура (кадры и снаряжение)
rem    targets   — Досье (аналитический отдел)
rem    counter   — Контрразведка (внутренняя защита)
rem    alerts    — Тревоги (дежурная смена)
rem    captives  — Плен (изолятор резидентуры)
rem    log       — Журнал (архив дел)
rem  Один файл на вкладку. Широкий кадр (~3:1, от 1200 px), нижняя треть
rem  уходит под текст резидентуры — не занимай её важным.
rem  Файла нет — вкладка рисует градиент, ничего не ломается.
rem  Альтернатива: админка → вкладка «🕵 Разведка» (жмёт картинку сама).
rem  После заливки: git add assets\intel, коммит, деплой.
rem ══════════════════════════════════════════════════════════════════
setlocal
set "DEST=%~dp0..\assets\intel"
if not exist "%DEST%" mkdir "%DEST%"
if "%~1"=="" (
  echo Перетащи картинки на этот файл. Папка назначения: %DEST%
  echo Имена: ops agents targets counter alerts captives log ^(.webp/.png/.jpg^)
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
