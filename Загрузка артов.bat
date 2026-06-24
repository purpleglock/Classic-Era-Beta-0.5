@echo off
cd /d "%~dp0"
echo.
echo   ================================================
echo     ART UPLOAD SERVER  /  SERVER ZAGRUZKI ARTOV
echo   ================================================
echo.
echo     Ne zakryvay eto okno, poka gruzish portrety.
echo     Kogda zakonchish - prosto zakroy okno.
echo.
node "tools\upload-server.js"
echo.
echo   Server ostanovlen. Mozhno zakryt okno.
pause
