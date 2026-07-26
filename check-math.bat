@echo off
chcp 65001 >nul
setlocal
title Сочи - Sochi Sunset - проверка математики
cd /d "%~dp0"

rem Файл обязан быть сохранён с переводами строк CRLF — см. пояснение
rem в start.bat.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js не найден. Установите Node 22.5 или новее: https://nodejs.org
  echo.
  goto :halt
)

echo.
echo ================== ТЕСТЫ ==================
node --test "server/test/**/*.test.js"

echo.
echo ================== ОТЧЁТ ПО RTP ==================
node server\src\tools\rtp-report.js

echo.
echo ============ СИМУЛЯЦИЯ 5 МЛН СПИНОВ ============
echo Займёт около минуты.
node server\src\tools\simulate.js --spins 5000000

:halt
echo.
pause
endlocal
