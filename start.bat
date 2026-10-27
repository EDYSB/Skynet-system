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
start "SKYNET-SERVER" /b node server.js
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8792
echo.
echo   Local: http://127.0.0.1:8792
echo   LAN:   check the server window for the 172.x.x.x address
echo   Close this window to stop the local service.
echo.
pause
