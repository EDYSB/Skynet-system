@echo off
rem Add tools\bin to PATH for the current window only.
set "PATH=%~dp0bin;%PATH%"
echo tools\bin added to PATH (this window only).
echo   sqlmap --version
echo   vol --help
