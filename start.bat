@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SKYNET
echo.
echo   SKYNET - SECURE GATEWAY / LOCAL PROBE
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js was not found in PATH.
  echo   Install Node.js, then run this file again.
  pause
  exit /b 1
)

netstat -ano | findstr /C:":8792 " | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo   Port 8792 is already in use: an instance is already running.
  echo   Reusing it - no second copy was started.
  echo   To restart, close the existing service window first, then run this file again.
  echo.
  start "" http://127.0.0.1:8792
  pause
  exit /b 0
)

echo   Starting service ...
if exist "%~dp0local.credentials.bat" (
  call "%~dp0local.credentials.bat"
  echo   Using local credentials override.
)
start "SKYNET-SERVER" /b node server.js
timeout /t 2 /nobreak >nul
netstat -ano | findstr /C:":8792 " | findstr /C:"LISTENING" >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Startup failed: port 8792 is not listening.
  echo   Read the error printed above, fix it, then run this file again.
  echo.
  pause
  exit /b 1
)

start "" http://127.0.0.1:8792
echo.
echo   Local: http://127.0.0.1:8792
echo   LAN:   check the server window for the 172.x.x.x address
echo   Close this window to stop the local service.
echo.
pause
