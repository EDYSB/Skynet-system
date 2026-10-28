@echo off
rem Volatility 3 launcher: point cache to the project dir (AppData write is denied)
setlocal
set "HERE=%~dp0"
set "PYTHONPATH=%HERE%py"
set "APPDATA=%HERE%..\.cache"
if not exist "%APPDATA%" mkdir "%APPDATA%"
"%HERE%py\bin\vol.exe" %*
