@echo off
chcp 65001 >nul
rem ══════════════════════════════════════════════════════════════════
rem  Арт карт Межзвёздной Ассамблеи.
rem  Перетащи файлы картинок НА этот батник — они лягут в assets\assembly\.
rem  Ожидаемые имена (webp или png):
rem    card_lib    — Закон Федерации        card_gal — Директива
rem    card_back   — рубашка карты          role_lib — Федералист
rem    role_gal    — Галактоцентрист        role_archon — Архонт
rem  Без файла клиент рисует фолбэк-карту сам, ничего не ломается.
rem ══════════════════════════════════════════════════════════════════
setlocal
set "DEST=%~dp0..\assets\assembly"
if not exist "%DEST%" mkdir "%DEST%"
if "%~1"=="" (
  echo Перетащи картинки на этот файл. Папка назначения: %DEST%
  echo Ожидаемые имена: card_lib card_gal card_back role_lib role_gal role_archon ^(.webp/.png^)
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
