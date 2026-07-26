@echo off
chcp 65001 >nul
setlocal
title Сочи - Sochi Sunset - локальный сервер
cd /d "%~dp0"

rem ВАЖНО: этот файл обязан быть сохранён с переводами строк CRLF.
rem cmd.exe читает bat-файл как поток байт и при одних только LF
rem склеивает команды в мусор — окно закрывается мгновенно, без единого
rem сообщения. Если правите файл, убедитесь, что редактор не «починил»
rem переводы строк на Unix-овые.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js не найден.
  echo   Установите Node 22.5 или новее: https://nodejs.org
  echo.
  goto :halt
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if not defined NODEMAJOR (
  echo.
  echo   Не удалось определить версию Node.
  node -v
  echo.
  goto :halt
)
if %NODEMAJOR% LSS 22 (
  echo.
  echo   Нужен Node 22.5 или новее. Установленная версия:
  node -v
  echo   Скачать: https://nodejs.org
  echo.
  goto :halt
)

echo.
echo   Сочи - Sochi Sunset
echo   Сервер поднимается на http://localhost:3000
echo   Браузер откроется сам через пару секунд.
echo   Остановить игру: закрыть это окно или Ctrl+C.
echo.

start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:3000"
node server\src\index.js
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo   Сервер завершился с ошибкой, код %EXITCODE%.
  echo   Частая причина: порт 3000 уже занят другим запуском игры.
  echo   Закройте прошлое окно сервера или задайте другой порт:
  echo       set PORT=3001
  echo       node server\src\index.js
) else (
  echo   Сервер остановлен.
)

:halt
echo.
pause
endlocal
