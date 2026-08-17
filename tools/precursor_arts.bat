@echo off
chcp 65001 >nul
rem  Arty dozvezdnyh mirov: rasa x epoha.
rem  Peretashi kartinki NA etot fayl - oni lyagut v assets\precursor\worlds
rem  i obnovitsya manifest.json. Imya fayla: rasa_epoha[_nomer].webp
rem  Naprimer: humanoid_E8.webp  common_E3.webp  aquatic_E5_2.png
rem  Vsya logika i podskazki - v tools\precursor_arts.js (tam zhe spisok ras
rem  i epoh na russkom: cmd kirillicu v komentariyah ne perevarivaet).
setlocal
node "%~dp0precursor_arts.js" %*
if errorlevel 1 echo.& echo Ne nashelsya node? Ustanovi Node.js i zapusti snova.
echo.
pause
