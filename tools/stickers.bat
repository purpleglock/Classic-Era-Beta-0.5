@echo off
rem ==================================================================
rem  Стикеры чата "Гиперсвязь". ОДИН БАТНИК - И ВСЁ.
rem
rem  Перетащи картинки НА этот файл. Они лягут в assets\stickers\,
rem  а батник перепишет список assets\stickers\index.json.
rem
rem  ЗАЧЕМ СПИСОК. Браузер не умеет читать папку на диске: без этого
rem  файла админка не знает, что ты залил, и ключи пришлось бы вбивать
rem  руками. Со списком она сама показывает "новых: N" и заводит их
rem  одной кнопкой.
rem
rem  ИМЯ ФАЙЛА = КЛЮЧ СТИКЕРА (латиница, цифры, дефис):
rem    kot-ugar.webp  ->  ключ  kot-ugar
rem  Кириллицу и пробелы в имени не бери: ключ уходит в ссылку.
rem  Годится webp/png/jpg/gif/svg, квадрат от 512 px.
rem
rem  ВНИМАНИЕ, КОДИРОВКА. Файл сохранён в CP866 и БЕЗ chcp: cmd читает
rem  батник ДО того, как chcp успеет сработать, поэтому UTF-8 здесь
rem  рассыпается на "не является внутренней командой".
rem
rem  Дальше: админка -> "Стикеры" -> "Завести все новые", и разложить
rem  подпись с окном под флаг мышью.
rem  После заливки: git add assets\stickers, коммит, деплой.
rem ==================================================================
setlocal
set "DEST=%~dp0..\assets\stickers"
if not exist "%DEST%" mkdir "%DEST%"
set "DROPPED=%~1"

echo.
:loop
if "%~1"=="" goto copied
copy /y "%~1" "%DEST%\%~nx1" >nul && echo   [OK] %~nx1 || echo   [FAIL] %~nx1
shift
goto loop
:copied

rem Список для админки. Отдельным .ps1: многострочный powershell с ^ внутри
rem кавычек cmd рвёт на части и получается "DEST не является командой".
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stickers_index.ps1" -Dir "%DEST%"

echo.
echo   Spisok obnovlen: index.json
echo   Dalshe: admin-panel -^> "Stikery" -^> "Zavesti vse novye".
echo.
if "%DROPPED%"=="" start "" "%DEST%"
pause
